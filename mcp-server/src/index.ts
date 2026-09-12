import OAuthProvider from '@cloudflare/workers-oauth-provider';
import app from './app';
import { TalebElmMcp } from './mcp-agent';

export { TalebElmMcp };

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: TalebElmMcp.mount('/mcp') as any,
  defaultHandler: app as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
