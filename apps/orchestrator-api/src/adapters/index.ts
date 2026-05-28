import type { ExpressIngressAdapter } from "./types";
import { feishuIngressAdapter } from "./feishu";
import { httpIngressAdapter } from "./http";

export const ingressAdapters: ExpressIngressAdapter[] = [
  httpIngressAdapter,
  feishuIngressAdapter
];
