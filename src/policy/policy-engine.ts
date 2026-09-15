import type {
  CapabilityStep,
  RiskClassification,
} from "../artifacts/schema.js";

export const PolicyErrorCode = {
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  ACTION_NOT_ALLOWED: "ACTION_NOT_ALLOWED",
  RISK_NOT_ALLOWED: "RISK_NOT_ALLOWED",
} as const;

export type PolicyErrorCode =
  (typeof PolicyErrorCode)[keyof typeof PolicyErrorCode];

export type PolicyDecision = "allow" | "block";

export type PolicyConfiguration = {
  allowedOrigins?: string[];
  allowedDomains?: string[];
  allowedActionTypes: CapabilityStep["type"][];
  riskHandling?: Partial<Record<RiskClassification, PolicyDecision>>;
};

export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
    readonly details: {
      stepId?: string;
      expected?: string;
      observed?: string;
    } = {},
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const DEFAULT_RISK_HANDLING: Record<RiskClassification, PolicyDecision> = {
  safe: "allow",
  reversible: "allow",
  irreversible: "block",
};

export class PolicyEngine {
  private readonly allowedOrigins: Set<string>;
  private readonly allowedDomains: string[];
  private readonly allowedActionTypes: Set<CapabilityStep["type"]>;
  private readonly riskHandling: Record<RiskClassification, PolicyDecision>;

  constructor(configuration: PolicyConfiguration) {
    this.allowedOrigins = new Set(
      (configuration.allowedOrigins ?? []).map((origin) =>
        new URL(origin).origin.toLowerCase(),
      ),
    );
    this.allowedDomains = (configuration.allowedDomains ?? []).map((domain) =>
      domain.toLowerCase().replace(/^\./, ""),
    );
    this.allowedActionTypes = new Set(configuration.allowedActionTypes);
    this.riskHandling = {
      ...DEFAULT_RISK_HANDLING,
      ...configuration.riskHandling,
    };
  }

  enforceOrigin(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PolicyError(
        PolicyErrorCode.ORIGIN_NOT_ALLOWED,
        `Target URL "${url}" is invalid or not allowed.`,
        { observed: url },
      );
    }

    const originAllowed = this.allowedOrigins.has(parsed.origin.toLowerCase());
    const hostname = parsed.hostname.toLowerCase();
    const domainAllowed = this.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );

    if (!originAllowed && !domainAllowed) {
      throw new PolicyError(
        PolicyErrorCode.ORIGIN_NOT_ALLOWED,
        `Origin "${parsed.origin}" is not allowed by replay policy.`,
        {
          expected: "An allowed origin or domain",
          observed: parsed.origin,
        },
      );
    }
  }

  enforceStep(step: CapabilityStep): void {
    if (!this.allowedActionTypes.has(step.type)) {
      throw new PolicyError(
        PolicyErrorCode.ACTION_NOT_ALLOWED,
        `Action type "${step.type}" is not allowed by replay policy.`,
        {
          stepId: step.id,
          expected: [...this.allowedActionTypes].join(", "),
          observed: step.type,
        },
      );
    }

    if (this.riskHandling[step.risk] === "block") {
      throw new PolicyError(
        PolicyErrorCode.RISK_NOT_ALLOWED,
        `Step "${step.id}" is blocked because its risk is "${step.risk}".`,
        {
          stepId: step.id,
          expected: "An allowed risk classification",
          observed: step.risk,
        },
      );
    }
  }
}
