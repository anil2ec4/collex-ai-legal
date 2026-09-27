"""W21 platform lane — the macOS entrypoints parse (acceptance M, part 2).

UNVALIDATED ON PHYSICAL MAC. These checks prove that the launchd templates
under deploy/macos/launchd are well-formed property lists whose programs and
hosts stay on this machine, and that the shell scripts are syntactically
valid bash whose ColleX process-matching rule behaves as documented. They do
NOT prove that anything runs on a Mac.

``bash -n`` needs a POSIX bash. On Windows that is Git Bash; the WSL launcher
in System32 is refused (it would run a different system). When no usable bash
exists the bash checks are an ENVIRONMENT BLOCKER skip, never a pass.
"""

from __future__ import annotations

import plistlib
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MACOS = REPO / "deploy" / "macos"
LAUNCHD = MACOS / "launchd"
PLISTS = sorted(LAUNCHD.glob("*.plist"))
SCRIPTS = sorted(MACOS.glob("*.sh"))
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def test_inventory() -> None:
    assert [p.name for p in PLISTS] == [
        "com.collex.app.plist",
        "com.collex.backup.plist",
        "com.collex.llm.plist",
        "com.collex.postgres.plist",
    ]
    assert [s.name for s in SCRIPTS] == [
        "collex-backup.sh",
        "collex-env.sh",
        "collex-restore.sh",
        "collex-start.sh",
        "collex-stop.sh",
        "collex-verify.sh",  # W23: on-machine verification, read-only
    ]


@pytest.mark.parametrize("plist", PLISTS, ids=lambda p: p.name)
def test_plist_parses_and_stays_local(plist: Path) -> None:
    data = plistlib.loads(plist.read_bytes())
    assert data["Label"] == plist.stem
    args = data["ProgramArguments"]
    assert args and all(isinstance(a, str) for a in args)
    env = data.get("EnvironmentVariables", {})
    values = list(args) + [str(v) for v in env.values()]
    for value in values:
        assert "\\" not in value, value
        assert not re.match(r"^[A-Za-z]:", value), value
        assert ".exe" not in value.lower(), value
        for host in re.findall(r"://(?:[^@/\s]+@)?([^/:\s]+)", value):
            assert host in LOCAL_HOSTS, value
    for index, arg in enumerate(args):
        if arg in ("--host", "-h"):
            assert args[index + 1] in LOCAL_HOSTS
        if arg.startswith("listen_addresses="):
            assert arg == "listen_addresses=127.0.0.1"
    # Scripts are started through /bin/bash, so no executable bit is needed.
    if args[0] == "/bin/bash":
        script = args[1].replace("__COLLEX_HOME__", str(REPO))
        assert Path(script).is_file(), script


def _posix_bash() -> str | None:
    candidate = shutil.which("bash")
    if candidate is None or "system32" in candidate.lower():
        return None
    return candidate


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.name)
def test_script_is_valid_bash(script: Path) -> None:
    bash = _posix_bash()
    if bash is None:
        pytest.skip("ENVIRONMENT BLOCKER: no POSIX bash on PATH for `bash -n`")
    # The text goes through stdin, so the (non-ASCII) repo path never has to
    # survive a Windows-to-MSYS argument conversion.
    result = subprocess.run(
        [bash, "-n"], input=script.read_bytes(), capture_output=True, timeout=30, check=False
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")


def _run_with_env(snippet: str, before: str = "") -> str:
    """Source collex-env.sh (read from disk, fed on stdin) and run ``snippet``."""
    bash = _posix_bash()
    if bash is None:
        pytest.skip("ENVIRONMENT BLOCKER: no POSIX bash on PATH")
    env_text = (MACOS / "collex-env.sh").read_text(encoding="utf-8")
    program = (
        # On stdin BASH_SOURCE is empty, so COLLEX_HOME is pinned and the
        # file's own directory lookup is dropped.
        "COLLEX_HOME=/depo/ColleX; HOME=/Users/avukat; unset COLLEX_DATA_DIR COLLEX_DB_URL COLLEX_PGPORT\n"
        + before
        + env_text.replace('_collex_env_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"', "")
        + "\n"
        + snippet
    )
    result = subprocess.run(
        [bash, "-s"], input=program.encode("utf-8"), capture_output=True, timeout=30, check=False
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    return result.stdout.decode("utf-8")


def test_collex_command_line_rule() -> None:
    out = _run_with_env(
        "for c in "
        "'node /depo/ColleX/control-plane/scripts/serve.mjs --port 8787 --with-mcp' "
        "'/opt/homebrew/bin/node /depo/ColleX/control-plane/scripts/serve-mcp.mjs --parent-stdin' "
        "'/depo/ColleX/.venv/bin/python -m uvicorn asgi_app:app --port 8898' "
        "'/depo/ColleX/.venv/bin/python -m semantic_search.local_embedding_server --port 8899 --parent-stdin --collex-managed' "
        "'/depo/ColleX/.venv/bin/python -m semantic_search.local_embedding_server --port 8899' "
        "'node /baska/proje/serve.mjs' "
        "'postgres -D /Users/avukat/pg -p 55432'; do "
        'if collex_is_collex_cmd "$c"; then echo EVET; else echo HAYIR; fi; done\n'
    )
    assert out.split() == ["EVET", "EVET", "EVET", "EVET", "HAYIR", "HAYIR", "HAYIR"]


def test_env_defaults_are_local_and_follow_the_data_dir_rule() -> None:
    out = _run_with_env(
        'printf "%s\\n" "$COLLEX_DB_URL" "$COLLEX_VARDIR" "$COLLEX_HEALTH_URL" "$COLLEX_PY" "$COLLEX_LOG_DIR"\n'
    )
    assert out.splitlines() == [
        "postgres://postgres@127.0.0.1:55432/collex_local",
        "/depo/ColleX/var",
        "http://127.0.0.1:8787/v1/health",
        "/depo/ColleX/.venv/bin/python",
        "/Users/avukat/Library/Logs/ColleX",
    ]
    # COLLEX_DATA_DIR moves the data folder exactly as serve.mjs does.
    moved = _run_with_env('echo "$COLLEX_VARDIR"\n', before="COLLEX_DATA_DIR=/Volumes/Veri/ColleX\n")
    assert moved.strip() == "/Volumes/Veri/ColleX"


# ---------------------------------------------------------------------------
# W21 #27 — ~/.collex/collex.env is read strictly, never evaluated
# ---------------------------------------------------------------------------

_ENV_UNSET = (
    "unset COLLEX_DATA_DIR COLLEX_DB_URL COLLEX_PGPORT COLLEX_BACKUP_DIR COLLEX_LOG_DIR"
    " COLLEX_PGBIN COLLEX_PGDATA COLLEX_NODE COLLEX_ENV_FILE COLLEX_APP_PLIST COLLEX_PLISTBUDDY\n"
)


def _source_env(before: str, snippet: str) -> subprocess.CompletedProcess:
    """Like ``_run_with_env`` but returns the process, so a refusal can be read."""
    bash = _posix_bash()
    if bash is None:
        pytest.skip("ENVIRONMENT BLOCKER: no POSIX bash on PATH")
    env_text = (MACOS / "collex-env.sh").read_text(encoding="utf-8")
    program = (
        "COLLEX_HOME=/depo/ColleX; HOME=/Users/avukat\n"
        + _ENV_UNSET
        + 'D="$(mktemp -d)"\n'
        + before
        + env_text.replace('_collex_env_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"', "")
        + "\n"
        + snippet
    )
    return subprocess.run(
        [bash, "-s"], input=program.encode("utf-8"), capture_output=True, timeout=30, check=False
    )


def _env_file(*lines: str) -> str:
    """Bash that writes ``lines`` (verbatim, LF-terminated) to $D/collex.env."""
    quoted = " ".join("'" + line.replace("'", "'\\''") + "'" for line in lines)
    return f"printf '%s\\n' {quoted} > \"$D/collex.env\"\nCOLLEX_ENV_FILE=\"$D/collex.env\"\n"


def test_env_file_reads_crlf_comments_and_blank_lines_exactly() -> None:
    # A file saved on Windows during the migration: every line ends in CR.
    # The CRs are written by printf escapes (a raw CR inside the bash program
    # text would be dropped by Git Bash while it parses the script).
    result = _source_env(
        "printf 'COLLEX_PGPORT=55433\\r\\n# yorum\\r\\n\\r\\n   # girintili yorum\\n"
        "COLLEX_DATA_DIR=/Users/a/ColleX Veri\\r\\nCOLLEX_BACKUP_DIR=/dosyadan\\n' > \"$D/collex.env\"\n"
        'COLLEX_ENV_FILE="$D/collex.env"\n'
        "COLLEX_BACKUP_DIR=/ortamdan\n",
        'printf "crs=%s\\n" "$(tr -cd \'\\r\' < "$D/collex.env" | wc -c | tr -d \' \')"\n'
        'printf "[%s]\\n" "$COLLEX_PGPORT" "$COLLEX_DATA_DIR" "$COLLEX_VARDIR" "$COLLEX_BACKUP_DIR" "$COLLEX_DB_URL"\n',
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    out = result.stdout.decode("utf-8")
    lines = out.split("\n")
    assert lines[0] == "crs=4"  # the fixture really is a CRLF file
    assert "\r" not in out  # before W21: "55433\r" and "...Veri\r" were exported
    assert lines[1:-1] == [
        "[55433]",
        "[/Users/a/ColleX Veri]",
        "[/Users/a/ColleX Veri]",
        "[/ortamdan]",  # a value already in the environment (a plist) wins
        "[postgres://postgres@127.0.0.1:55433/collex_local]",
    ]


@pytest.mark.parametrize(
    ("line", "reason"),
    [
        ("COLLEX_DATA_DIR = /Users/a/gizli-deger", "boşluk yok"),
        ("  COLLEX_BACKUP_DIR=/Users/a/gizli-deger", "satırın başında"),
        ('COLLEX_DATA_DIR="/Users/a/gizli-deger"', "tırnak"),
        ("COLLEX_DATA_DIR='/Users/a/gizli-deger'", "tırnak"),
        ("COLLEX_LOG_DIR=", "boş"),
        ("COLLEX_DATA_DIR=/Users/a/gizli-deger ", "boşluk var"),
        ("export COLLEX_PGPORT=55433", "satırın başında"),
        ("COLLEX_DATA_DIR=$HOME/gizli-deger", "tam yolu"),
        ("COLLEX_DATA_DIR=~/gizli-deger", "tam yolu"),
        ("COLLEX_data_dir=/Users/a/gizli-deger", "büyük harf"),
        ("PATH=/Users/a/gizli-deger", "COLLEX_ ile"),
        ("COLLEX_=/Users/a/gizli-deger", "anahtar adı eksik"),
        ("COLLEX_DATA_DIR", "KEY=değer"),
    ],
)
def test_env_file_malformed_line_stops_the_script(line: str, reason: str) -> None:
    # A VALID line first: before W21 exactly this order let the script go on
    # with the <repo>/var default after "bad substitution".
    result = _source_env(
        _env_file("COLLEX_PGBIN=/opt/homebrew/bin", line),
        'echo "DEVAM EDILDI $COLLEX_VARDIR"\n',
    )
    stderr = result.stderr.decode("utf-8", errors="replace")
    assert result.returncode == 64, stderr
    assert "DEVAM EDILDI" not in result.stdout.decode("utf-8")
    assert "2. satırı okunamadı" in stderr
    assert reason in stderr
    # The refusal names the line, never the value (it could be a secret).
    assert "gizli-deger" not in stderr


@pytest.mark.parametrize(
    "line",
    [
        "COLLEX_X}$(echo INJECTED-RAN >&2)=v",
        'COLLEX_X$(touch "$D/ele-gecirildi")=v',
        "COLLEX_X`echo INJECTED-RAN >&2`=v",
    ],
)
def test_env_file_key_can_never_run_a_command(line: str) -> None:
    result = _source_env(
        _env_file(line),
        "",
    )
    output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
    assert result.returncode == 64, output
    # Before W21 the first line printed INJECTED-RAN through eval.
    assert "INJECTED-RAN\n" not in output
    assert "okunamadı" in output
    # And nothing in the loader evaluates text at all any more.
    source = (MACOS / "collex-env.sh").read_text(encoding="utf-8")
    assert not re.search(r"^\s*eval\b", source, flags=re.MULTILINE)


def test_env_file_injection_leaves_no_trace() -> None:
    # The loader runs in a subshell here, so the check after its refusal runs
    # in the same program and the same scratch folder.
    result = _source_env(
        _env_file('COLLEX_X$(touch "$D/ele-gecirildi")=v') + "(\n",
        ')\necho "rc=$?"\nif [ -e "$D/ele-gecirildi" ]; then echo VAR; else echo YOK; fi\n',
    )
    assert result.stdout.decode("utf-8").split() == ["rc=64", "YOK"]


# ---------------------------------------------------------------------------
# W21 #24 — a hand-run backup/restore names its uploads folder and stops when
# the installed service uses a different one
# ---------------------------------------------------------------------------

_PLIST_STUB = (
    'mkdir -p "$D/ev/Library/LaunchAgents" && : > "$D/ev/Library/LaunchAgents/com.collex.app.plist"\n'
    "printf '#!/bin/bash\\necho /Users/avukat/ColleX/data\\n' > \"$D/PlistBuddy\" && chmod +x \"$D/PlistBuddy\"\n"
    'HOME="$D/ev"; COLLEX_PLISTBUDDY="$D/PlistBuddy"\n'
)


def test_uploads_check_stops_when_the_service_keeps_its_data_elsewhere() -> None:
    result = _source_env(_PLIST_STUB, 'collex_check_uploads_dir; echo "rc=$?"\n')
    out = result.stdout.decode("utf-8")
    err = result.stderr.decode("utf-8", errors="replace")
    assert "rc=64" in out
    assert "/depo/ColleX/var/uploads (COLLEX_DATA_DIR ayarlı değil" in out
    assert "DURDURULDU" in err
    assert "/Users/avukat/ColleX/data/uploads" in err
    assert "~/.collex/collex.env" in err


def test_uploads_check_passes_when_the_folders_agree_and_names_the_source() -> None:
    result = _source_env(
        _PLIST_STUB + "COLLEX_DATA_DIR=/Users/avukat/ColleX/data/\n",
        'collex_check_uploads_dir; echo "rc=$?"\n',
    )
    out = result.stdout.decode("utf-8")
    assert "rc=0" in out
    assert "(COLLEX_DATA_DIR)" in out
    assert "DURDURULDU" not in result.stderr.decode("utf-8", errors="replace")


def test_uploads_check_without_a_service_warns_about_a_missing_fallback_folder() -> None:
    result = _source_env("", 'collex_check_uploads_dir; echo "rc=$?"\n')
    assert "rc=0" in result.stdout.decode("utf-8")
    assert "/depo/ColleX/var/uploads klasörü yok" in result.stderr.decode("utf-8", errors="replace")


def test_backup_and_restore_wrappers_check_the_uploads_folder_before_anything_runs() -> None:
    backup = (MACOS / "collex-backup.sh").read_text(encoding="utf-8")
    restore = (MACOS / "collex-restore.sh").read_text(encoding="utf-8")
    check = "collex_check_uploads_dir || exit $?"
    assert backup.index(check) < backup.index('"$COLLEX_BACKUP_MJS"')
    assert restore.index(check) < restore.index('"$COLLEX_BACKUP_MJS" --verify')
    # The confirmation names the folder the originals go into.
    assert restore.index("Belge asılları şu klasöre birleştirilecek") < restore.index("read -r ONAY")
    assert '${ALLOW_EMPTY:+"$ALLOW_EMPTY"}' in backup
    assert '${CREATE_UPLOADS:+"$CREATE_UPLOADS"}' in restore


_RESTORE_SOURCE_LINE = '. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"'


def _run_restore_wrapper(restore_rc: int) -> subprocess.CompletedProcess:
    """Run collex-restore.sh --yes with fake node / pg_isready.

    The fake node answers ``--verify`` with success and ``--restore`` with
    ``restore_rc``, the exit code backup.mjs uses (0 complete, 1 failed or
    known-incomplete, 3 restored but the originals were NOT checked).
    """
    bash = _posix_bash()
    if bash is None:
        pytest.skip("ENVIRONMENT BLOCKER: no POSIX bash on PATH")
    env_text = (MACOS / "collex-env.sh").read_text(encoding="utf-8").replace(
        '_collex_env_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"', ""
    )
    restore = (MACOS / "collex-restore.sh").read_text(encoding="utf-8")
    assert restore.count(_RESTORE_SOURCE_LINE) == 1
    program = (
        _ENV_UNSET
        + 'D="$(mktemp -d)"\n'
        + "trap 'rm -rf \"$D\"' EXIT\n"
        + 'COLLEX_HOME=/depo/ColleX; HOME="$D/ev"\n'
        + 'mkdir -p "$D/bin" "$D/veri/uploads" "$D/yedek"\n'
        + "printf '#!/bin/bash\\nexit 0\\n' > \"$D/bin/pg_isready\"\n"
        + "printf '#!/bin/bash\\ncase \" $* \" in *\" --restore \"*) echo \"[ColleX] sahte geri yükleme\"; exit "
        + str(restore_rc)
        + ";; esac\\necho \"[ColleX] Yedek doğrulandı\"\\nexit 0\\n' > \"$D/node\"\n"
        + 'chmod +x "$D/bin/pg_isready" "$D/node"\n'
        + 'COLLEX_NODE="$D/node"; COLLEX_PGBIN="$D/bin"; COLLEX_DATA_DIR="$D/veri"\n'
        + 'COLLEX_APP_PORT=9; COLLEX_APP_PLIST="$D/yok.plist"; COLLEX_ENV_FILE="$D/yok.env"\n'
        + 'export COLLEX_NODE COLLEX_PGBIN COLLEX_DATA_DIR COLLEX_APP_PORT COLLEX_APP_PLIST COLLEX_ENV_FILE\n'
        + 'set -- "$D/yedek" --yes\n'
        + restore.replace(_RESTORE_SOURCE_LINE, env_text)
    )
    return subprocess.run(
        [bash, "-s"], input=program.encode("utf-8"), capture_output=True, timeout=60, check=False
    )


def test_restore_wrapper_says_tamam_only_when_backup_mjs_verified_everything() -> None:
    done = _run_restore_wrapper(0)
    assert done.returncode == 0, done.stderr.decode("utf-8", errors="replace")
    assert "Geri yükleme tamam" in done.stdout.decode("utf-8")


def test_restore_wrapper_never_says_tamam_over_unverified_originals() -> None:
    # W21 #24: backup.mjs --restore exits 3 when the database was restored but
    # the originals the restored database names could not be checked. The
    # wrapper used to print "Geri yükleme tamam" for every exit 0 and
    # "TAMAMLANMADI ... hiçbir veri silinmedi" for everything else.
    unverified = _run_restore_wrapper(3)
    out = unverified.stdout.decode("utf-8")
    err = unverified.stderr.decode("utf-8", errors="replace")
    assert unverified.returncode == 3, err
    assert "Geri yükleme tamam" not in out + err
    assert "DENETLENEMEDİ" in err
    assert "TAMAMLANMADI" not in err

    failed = _run_restore_wrapper(1)
    assert failed.returncode == 1
    assert "Geri yükleme tamam" not in failed.stdout.decode("utf-8")
    assert "TAMAMLANMADI" in failed.stderr.decode("utf-8", errors="replace")
