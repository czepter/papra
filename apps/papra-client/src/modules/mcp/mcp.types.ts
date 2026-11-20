export type ConnectedApp = {
  clientId: string;
  clientName: string | undefined;
  redirectHosts: string[];
  scopes: string[];
  authorizedAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | undefined;
};
