---
'@papra/app': minor
---

The MCP server at `/mcp` now offers 20 more tools. Read tools: `search_documents`, `get_document`, `read_document_content` (reads long texts in slices), `list_tags`, `list_custom_properties`, `get_custom_property` and `get_document_custom_properties`. Write tools: `update_document`, `upload_document` (base64 content, up to 10 MB encoded and the file size limit of the organization plan), `create_tag`, `update_tag`, `delete_tag`, `add_document_tag`, `remove_document_tag`, `create_custom_property`, `update_custom_property`, `delete_custom_property`, `set_document_custom_property`, `delete_document_custom_property` and `enrich_document`. Each tool needs the same API key permissions as the matching REST route and only reaches organizations the API key owner is a member of. Requests to `/mcp` larger than 11 MB are now refused with a 413.
