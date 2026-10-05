declare global {
  namespace Cloudflare {
    interface Env {
      VERSION_METADATA: { id: string; tag: string };
    }
  }
}

export {};
