---
'@papra/app': minor
---

MCP clients can now ask Papra to extract the text of a document again with the new `reprocess_document` tool, for example after changing the OCR languages. It follows the same rules as reprocessing in the app: the job runs in the background, the existing text and tags stay until it finishes, and the per-organization reprocessing limit applies. When the limit is reached, the tool answers with the number of seconds to wait.
