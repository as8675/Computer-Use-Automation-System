import type {
  DiscoveryAction,
  DiscoveryDecisionInput,
} from "./schema.js";

export interface DiscoveryModel {
  decide(input: DiscoveryDecisionInput): Promise<DiscoveryAction>;
}
