/**
 * Tests for the Ocarina OTCRegistry descriptor:
 * - EIP-712 TipAuthorization bound to the OTCRegistry contract by
 *   deployments + domain (name = "OTCRegistry", version = "1").
 * - Exercises a bundled field group over the `tips` array with
 *   mustMatch-hidden children (`itemType`, `identifier`), a `tokenAmount`
 *   with per-item `tokenPath` and a `nativeCurrencyAddress` metadata
 *   constant, a `separator`, and a child array path in the
 *   interpolated intent (`{tips.[].amount}`).
 *
 * The descriptor is adapted from the registry submission: the out-of-sync
 * `visible.mustBe` keyword was renamed to the spec's `mustMatch`, and the
 * two always-hidden fields carry an explicit `format`.
 */

import { describe, it, expect, assert } from "vitest";
import { formatTypedData, isFieldGroup } from "../../../src/index.js";
import type { ExternalDataProvider, TypedData } from "../../../src/types.js";
import {
  buildFilesystemResolverOpts,
  computeEncodeTypeOrThrow,
} from "../../utils.js";

describe("Ocarina OTCRegistry TipAuthorization", () => {
  const CHAIN_ID = 1;
  const OTC_REGISTRY = "0x07C0000007b4B558e2fCd47F47A573413B0Caf7C";
  const SIGNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const FULFILLER = "0x1111111111111111111111111111111111111111";
  const RECIPIENT_A = "0x2222222222222222222222222222222222222222";
  const RECIPIENT_B = "0x3333333333333333333333333333333333333333";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

  const TYPES = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    TipAuthorization: [
      { name: "orderHash", type: "bytes32" },
      { name: "fulfiller", type: "address" },
      { name: "tips", type: "TipItem[]" },
      { name: "deadline", type: "uint256" },
    ],
    TipItem: [
      { name: "itemType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifier", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
  };

  const ENS_NAMES: Record<string, string> = {
    [FULFILLER.toLowerCase()]: "fulfiller.eth",
    [RECIPIENT_A.toLowerCase()]: "alice.eth",
    [RECIPIENT_B.toLowerCase()]: "bob.eth",
  };

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (
      chainId === CHAIN_ID &&
      tokenAddress.toLowerCase() === USDC_ADDRESS.toLowerCase()
    ) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    return null;
  };

  const resolveChainInfo: ExternalDataProvider["resolveChainInfo"] = async (
    chainId,
  ) => {
    if (chainId === CHAIN_ID) {
      return {
        name: "Ethereum Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      };
    }
    return null;
  };

  const resolveEnsName: ExternalDataProvider["resolveEnsName"] = async (
    address,
  ) => {
    const name = ENS_NAMES[address.toLowerCase()];
    return name ? { name, typeMatch: true } : null;
  };

  const TIP_AUTHORIZATION: TypedData = {
    account: SIGNER,
    domain: {
      name: "OTCRegistry",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: OTC_REGISTRY,
    },
    primaryType: "TipAuthorization",
    types: TYPES,
    message: {
      orderHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      fulfiller: FULFILLER,
      tips: [
        {
          itemType: "1", // ERC-20
          token: USDC_ADDRESS,
          identifier: "0",
          amount: "1000000", // 1 USDC
          recipient: RECIPIENT_A,
        },
        {
          itemType: "0", // native
          token: NATIVE_ADDRESS,
          identifier: "0",
          amount: "2000000000000000000", // 2 ETH
          recipient: RECIPIENT_B,
        },
      ],
      deadline: "1735689600", // 2025-01-01 00:00:00 UTC
    },
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        eip712DescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: OTC_REGISTRY,
            file: "eip712-OTCRegistry.json",
            encodeTypes: [
              computeEncodeTypeOrThrow(
                TIP_AUTHORIZATION.primaryType,
                TIP_AUTHORIZATION.types,
              ),
            ],
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats a TipAuthorization with bundled tips and interpolated child array amounts", async () => {
    const opts = buildOpts({ resolveToken, resolveChainInfo, resolveEnsName });

    const result = await formatTypedData(TIP_AUTHORIZATION, opts);

    expect(result.intent).toBe("Authorize tip");
    // The child array path {tips.[].amount} joins the rendered values of
    // all tip amounts. Separators are not part of the rendered values.
    expect(result.interpolatedIntent).toBe("Authorize 1 USDC and 2 ETH tip");

    assert(result.fields);
    // The top-level `tips.[]` field and `orderHash` are never visible.
    // Remaining: the bundled "Tips" group, fulfiller, and deadline.
    expect(result.fields).toHaveLength(3);

    // Field 0: bundled "Tips" group — itemType, token and identifier are
    // hidden, leaving amount + recipient per tip, paired by index.
    const tipsGroup = result.fields[0];
    assert(isFieldGroup(tipsGroup));
    expect(tipsGroup.label).toBe("Tips");
    expect(tipsGroup.warning).toBeUndefined();
    expect(tipsGroup.fields).toHaveLength(4);

    const tip0Amount = tipsGroup.fields[0];
    expect(tip0Amount.label).toBe("Tip amount");
    expect(tip0Amount.value).toBe("1 USDC");
    expect(tip0Amount.separator).toBe("Tip 0");
    expect(tip0Amount.fieldType).toBe("uint");
    expect(tip0Amount.format).toBe("tokenAmount");
    expect(tip0Amount.tokenAddress).toBe(USDC_ADDRESS);
    expect(tip0Amount.rawAddress).toBeUndefined();
    expect(tip0Amount.embeddedCalldata).toBeUndefined();
    expect(tip0Amount.warning).toBeUndefined();

    const tip0Recipient = tipsGroup.fields[1];
    expect(tip0Recipient.label).toBe("Tip to");
    expect(tip0Recipient.value).toBe("alice.eth");
    expect(tip0Recipient.separator).toBeUndefined();
    expect(tip0Recipient.fieldType).toBe("address");
    expect(tip0Recipient.format).toBe("addressName");
    expect(tip0Recipient.rawAddress).toBe(RECIPIENT_A);
    expect(tip0Recipient.tokenAddress).toBeUndefined();
    expect(tip0Recipient.embeddedCalldata).toBeUndefined();
    expect(tip0Recipient.warning).toBeUndefined();

    const tip1Amount = tipsGroup.fields[2];
    expect(tip1Amount.label).toBe("Tip amount");
    expect(tip1Amount.value).toBe("2 ETH");
    expect(tip1Amount.separator).toBe("Tip 1");
    expect(tip1Amount.fieldType).toBe("uint");
    expect(tip1Amount.format).toBe("tokenAmount");
    expect(tip1Amount.tokenAddress).toBe(NATIVE_ADDRESS);
    expect(tip1Amount.rawAddress).toBeUndefined();
    expect(tip1Amount.embeddedCalldata).toBeUndefined();
    expect(tip1Amount.warning).toBeUndefined();

    const tip1Recipient = tipsGroup.fields[3];
    expect(tip1Recipient.label).toBe("Tip to");
    expect(tip1Recipient.value).toBe("bob.eth");
    expect(tip1Recipient.separator).toBeUndefined();
    expect(tip1Recipient.fieldType).toBe("address");
    expect(tip1Recipient.format).toBe("addressName");
    expect(tip1Recipient.rawAddress).toBe(RECIPIENT_B);
    expect(tip1Recipient.tokenAddress).toBeUndefined();
    expect(tip1Recipient.embeddedCalldata).toBeUndefined();
    expect(tip1Recipient.warning).toBeUndefined();

    // Field 1: fulfiller
    const fulfillerField = result.fields[1];
    assert(!isFieldGroup(fulfillerField));
    expect(fulfillerField.label).toBe("Tip from");
    expect(fulfillerField.value).toBe("fulfiller.eth");
    expect(fulfillerField.fieldType).toBe("address");
    expect(fulfillerField.format).toBe("addressName");
    expect(fulfillerField.rawAddress).toBe(FULFILLER);
    expect(fulfillerField.tokenAddress).toBeUndefined();
    expect(fulfillerField.embeddedCalldata).toBeUndefined();
    expect(fulfillerField.warning).toBeUndefined();

    // Field 2: deadline
    const deadlineField = result.fields[2];
    assert(!isFieldGroup(deadlineField));
    expect(deadlineField.label).toBe("Expires");
    expect(deadlineField.value).toBe("2025-01-01 00:00:00Z");
    expect(deadlineField.fieldType).toBe("uint");
    expect(deadlineField.format).toBe("date");
    expect(deadlineField.rawAddress).toBeUndefined();
    expect(deadlineField.tokenAddress).toBeUndefined();
    expect(deadlineField.embeddedCalldata).toBeUndefined();
    expect(deadlineField.warning).toBeUndefined();

    // Metadata
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Ocarina");
    expect(result.metadata.contractName).toBe("OTCRegistry");
    expect(result.metadata.info).toEqual({ url: "https://ocarina.trade/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
