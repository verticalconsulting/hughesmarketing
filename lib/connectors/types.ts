import type { MetricSource } from "@/lib/domain/metrics";

export type MetricPointInput = { metric: string; date: string; dimension: string; value: number };
export type FetchContext = { identifiers: Record<string, string>; from: string; to: string };
/** Pure fetch + parse: credentials come from the environment, nothing touches the database. */
export type Connector = (ctx: FetchContext) => Promise<MetricPointInput[]>;
export type Connectors = Record<MetricSource, Connector>;
