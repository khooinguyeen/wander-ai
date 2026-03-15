declare module "chromadb" {
  export class ChromaClient {
    constructor(config: {
      host?: string;
      port?: number;
      ssl?: boolean;
      headers?: Record<string, string>;
      tenant?: string;
      database?: string;
    });

    getCollection(args: { name: string }): Promise<{
      count(): Promise<number>;
      get(args: {
        include?: string[];
        limit?: number;
        offset?: number;
      }): Promise<{
        ids: string[];
        metadatas: Array<Record<string, unknown> | null>;
        documents: Array<string | null>;
      }>;
      query(args: {
        queryTexts: string[];
        nResults: number;
        include?: string[];
      }): Promise<{
        ids?: string[][];
        metadatas?: Array<Array<Record<string, unknown>>>;
        distances?: Array<Array<number | null>>;
      }>;
    }>;
  }
}
