# bedesten_mcp_module/client.py

import asyncio
import base64
import hashlib
import io
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from legal_contracts import UpstreamContractError
from markitdown import MarkItDown

from bedesten_rate_limit import (
    BedestenRateLimited,
    bedesten_rate_limiter,
)

from .models import (
    BedestenSearchRequest, BedestenSearchResponse,
    BedestenDocumentRequest, BedestenDocumentResponse,
    BedestenDocumentMarkdown, BedestenDocumentRequestData
)
from .enums import get_full_birim_adi

logger = logging.getLogger(__name__)


class BedestenApiClient:
    """
    API Client for Bedesten (bedesten.adalet.gov.tr) - Alternative legal decision search system.
    Currently used for Yargıtay decisions, but can be extended for other court types.
    """
    BASE_URL = "https://bedesten.adalet.gov.tr"
    SEARCH_ENDPOINT = "/emsal-karar/searchDocuments"
    DOCUMENT_ENDPOINT = "/emsal-karar/getDocumentContent"
    
    def __init__(self, request_timeout: float = 60.0):
        self.http_client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={
                "Accept": "*/*",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "AdaletApplicationName": "UyapMevzuat",
                "Content-Type": "application/json; charset=utf-8",
                "Origin": "https://mevzuat.adalet.gov.tr",
                "Referer": "https://mevzuat.adalet.gov.tr/",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-site",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
            },
            timeout=request_timeout
        )
    
    async def search_documents(self, search_request: BedestenSearchRequest) -> BedestenSearchResponse:
        """
        Search for documents using Bedesten API.
        Currently supports: YARGITAYKARARI, DANISTAYKARARI, YERELHUKMAHKARARI, etc.
        """
        logger.info(f"BedestenApiClient: Searching documents with phrase: {search_request.data.phrase}")
        
        # Map abbreviated birimAdi to full Turkish name before sending to API
        original_birim_adi = search_request.data.birimAdi
        mapped_birim_adi = get_full_birim_adi(original_birim_adi)
        search_request.data.birimAdi = mapped_birim_adi
        if original_birim_adi != "ALL":
            logger.info(f"BedestenApiClient: Mapped birimAdi '{original_birim_adi}' to '{mapped_birim_adi}'")
        
        try:
            # Create request dict and remove birimAdi if empty
            request_dict = search_request.model_dump()
            if not request_dict["data"]["birimAdi"]:  # Remove if empty string
                del request_dict["data"]["birimAdi"]
            
            response = await bedesten_rate_limiter.post(
                self.http_client, self.SEARCH_ENDPOINT, "court search", json=request_dict,
            )
            response.raise_for_status()
            response_json = response.json()

            # Parse and return the response
            return BedestenSearchResponse(**response_json)

        except httpx.RequestError as e:
            logger.error(f"BedestenApiClient: HTTP request error during search: {e}")
            raise
        except Exception as e:
            logger.error(f"BedestenApiClient: Error processing search response: {e}")
            raise
    
    async def get_document_as_markdown(self, document_id: str) -> BedestenDocumentMarkdown:
        """
        Get document content and convert to markdown.
        Handles both HTML (text/html) and PDF (application/pdf) content types.
        """
        logger.info(f"BedestenApiClient: Fetching document for markdown conversion (ID: {document_id})")
        
        try:
            # Prepare request
            doc_request = BedestenDocumentRequest(
                data=BedestenDocumentRequestData(documentId=document_id)
            )
            
            # Get document
            response = await bedesten_rate_limiter.post(
                self.http_client, self.DOCUMENT_ENDPOINT,
                f"court document {document_id}", json=doc_request.model_dump(),
            )
            response.raise_for_status()
            response_json = response.json()
            doc_response = BedestenDocumentResponse(**response_json)
            
            # Add null safety checks for document data
            if not hasattr(doc_response, 'data') or doc_response.data is None:
                raise UpstreamContractError("Document response does not contain data")
            
            if not hasattr(doc_response.data, 'content') or doc_response.data.content is None:
                raise UpstreamContractError("Document data does not contain content")
                
            if not hasattr(doc_response.data, 'mimeType') or doc_response.data.mimeType is None:
                raise UpstreamContractError("Document data does not contain mimeType")
            
            # Decode base64 content with error handling
            try:
                content_bytes = base64.b64decode(doc_response.data.content)
            except Exception as e:
                raise UpstreamContractError("Failed to decode base64 content.") from e
            
            mime_type = doc_response.data.mimeType
            
            logger.info(f"BedestenApiClient: Document mime type: {mime_type}")
            
            # Convert to markdown based on mime type. markitdown is sync and
            # PDF parsing in particular can block the event-loop for seconds,
            # which on a single-worker uvicorn deployment stalls every other
            # in-flight MCP request and new TLS handshakes. Offload to a
            # thread so the event-loop stays responsive.
            if mime_type == "text/html":
                html_content = content_bytes.decode('utf-8')
                markdown_content = await asyncio.to_thread(
                    self._convert_html_to_markdown, html_content
                )
            elif mime_type == "application/pdf":
                markdown_content = await asyncio.to_thread(
                    self._convert_pdf_to_markdown, content_bytes
                )
            else:
                logger.warning(f"Unsupported mime type: {mime_type}")
                raise UpstreamContractError("Unsupported document content type.")
            
            # Canonical fetch contract: every consumer of this method (the
            # 'fetch' facade and 'get_bedesten_document_markdown' tool) gets
            # the same integrity hash and retrieval timestamp.
            content_sha256 = hashlib.sha256(
                (markdown_content or "").encode("utf-8")
            ).hexdigest()

            return BedestenDocumentMarkdown(
                documentId=document_id,
                markdown_content=markdown_content,
                source_url=f"https://mevzuat.adalet.gov.tr/ictihat/{document_id}",
                mime_type=mime_type,
                content_sha256=content_sha256,
                retrieved_at=datetime.now(timezone.utc).isoformat(),
            )
            
        except httpx.RequestError as e:
            logger.error(f"BedestenApiClient: HTTP error fetching document {document_id}: {e}")
            raise
        except Exception as e:
            logger.error(f"BedestenApiClient: Error processing document {document_id}: {e}")
            raise
    
    def _convert_html_to_markdown(self, html_content: str) -> Optional[str]:
        """Convert HTML to Markdown using MarkItDown"""
        if not html_content:
            return None
            
        try:
            # Convert HTML string to bytes and create BytesIO stream
            html_bytes = html_content.encode('utf-8')
            html_stream = io.BytesIO(html_bytes)
            
            # Pass BytesIO stream to MarkItDown to avoid temp file creation
            md_converter = MarkItDown()
            result = md_converter.convert(html_stream)
            markdown_content = result.text_content
            
            logger.info("Successfully converted HTML to Markdown")
            return markdown_content
            
        except Exception as e:
            logger.error(f"Error converting HTML to Markdown: {e}")
            raise UpstreamContractError("Document HTML could not be converted to Markdown.") from e
    
    def _convert_pdf_to_markdown(self, pdf_bytes: bytes) -> Optional[str]:
        """Convert PDF to Markdown using MarkItDown"""
        if not pdf_bytes:
            return None
            
        try:
            # Create BytesIO stream from PDF bytes
            pdf_stream = io.BytesIO(pdf_bytes)
            
            # Pass BytesIO stream to MarkItDown to avoid temp file creation
            md_converter = MarkItDown()
            result = md_converter.convert(pdf_stream)
            markdown_content = result.text_content
            
            logger.info("Successfully converted PDF to Markdown")
            return markdown_content
            
        except Exception as e:
            logger.error(f"Error converting PDF to Markdown: {e}")
            raise UpstreamContractError("Document PDF could not be converted to Markdown.") from e
    
    async def close_client_session(self):
        """Close HTTP client session"""
        await self.http_client.aclose()
        logger.info("BedestenApiClient: HTTP client session closed.")