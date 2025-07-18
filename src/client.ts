import axios, { AxiosInstance, AxiosError } from "axios";
import { Box, BoxConfig, CreateBoxRequest } from "./models";
import {
  mapHttpErrorToException,
  TavorError,
  AuthenticationError,
} from "./exceptions";
import { BoxHandle } from "./box-handle";

export interface TavorConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  httpClient?: AxiosInstance;
}

export class Tavor {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number; // HTTP request timeout in milliseconds
  private httpClient: AxiosInstance;

  constructor(config?: TavorConfig) {
    this.apiKey = config?.apiKey || process.env.TAVOR_API_KEY || "";
    this.baseUrl =
      config?.baseUrl || process.env.TAVOR_BASE_URL || "https://api.tavor.dev";
    this.timeout = config?.timeout || 30000;

    if (!this.apiKey) {
      throw new AuthenticationError(
        "API key is required. Set it via config or TAVOR_API_KEY environment variable.",
      );
    }

    this.httpClient =
      config?.httpClient ||
      axios.create({
        baseURL: this.baseUrl,
        timeout: this.timeout,
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
      });

    this.httpClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const { status, data } = error.response;
          const message =
            (data as Record<string, unknown>)?.error || error.message;
          throw mapHttpErrorToException(status, message as string, data);
        } else if (error.request) {
          throw new TavorError(`Request failed: ${error.message}`);
        } else {
          throw new TavorError(`Error: ${error.message}`);
        }
      },
    );
  }

  async createBox(config?: BoxConfig): Promise<BoxHandle> {
    const request: CreateBoxRequest = {};

    if (config?.timeout !== undefined) {
      request.timeout = config.timeout;
    }
    if (config?.metadata) {
      request.metadata = config.metadata;
    }
    if (config?.cpu !== undefined) {
      request.cpu = config.cpu;
    }
    if (config?.mib_ram !== undefined) {
      request.mib_ram = config.mib_ram;
    }

    const response = await this.httpClient.post<{ id: string }>(
      "/api/v2/boxes",
      request,
    );

    return new BoxHandle(response.data.id, {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      httpClient: this.httpClient,
      timeout: this.timeout,
    });
  }

  async listBoxes(): Promise<Box[]> {
    const response = await this.httpClient.get<{ data: Box[] }>(
      "/api/v2/boxes",
    );
    return response.data.data;
  }

  async getBox(boxId: string): Promise<BoxHandle> {
    return new BoxHandle(boxId, {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      httpClient: this.httpClient,
      timeout: this.timeout,
    });
  }

  async withSandbox<T>(
    callback: (box: BoxHandle) => Promise<T>,
    config?: BoxConfig,
  ): Promise<T> {
    const boxTimeout =
      config?.timeout || parseInt(process.env.TAVOR_BOX_TIMEOUT || "600");
    const boxConfig = { ...config, timeout: boxTimeout };

    const box = await this.createBox(boxConfig);

    try {
      await box.waitUntilReady();
      const result = await callback(box);
      return result;
    } finally {
      try {
        await box.stop();
      } catch (error) {
        console.error(`Failed to stop box ${box.id}:`, error);
      }
    }
  }
}
