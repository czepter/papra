---
'@papra/app': minor
---

The MCP page in the user settings now lists the apps you approved to access your account, with the permissions they hold, when you approved them and when they were last active. Revoking an app cuts it off immediately: its access and refresh tokens stop working and it has to be approved again. The approval page now says where access can be revoked, keeps the Allow and Deny buttons in reading order on small screens, and marks permissions that delete data. A new guide, "Connect an MCP client", explains the server URL, the sign-in and API key options, the tools and the reverse proxy setup for the registration rate limit.
