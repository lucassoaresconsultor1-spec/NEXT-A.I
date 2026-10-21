import { describe, expect, it } from "vitest";
import { acceptProviderStatus, fiscalFiltersSchema } from "./schemas";

const key = "3".repeat(44);

describe("acceptProviderStatus", () => {
  it("keeps a complete authorization", () => {
    expect(acceptProviderStatus({ status: "authorized", accessKey: key, number: "123", series: "1", protocol: "135260000000001" })).toEqual({
      status: "authorized",
      accessKey: key,
      number: "123",
      series: "1",
      protocol: "135260000000001",
    });
  });

  it.each([
    ["missing key", { accessKey: undefined, number: "1", protocol: "2" }],
    ["short key", { accessKey: "123", number: "1", protocol: "2" }],
    ["missing number", { accessKey: key, number: undefined, protocol: "2" }],
    ["missing protocol", { accessKey: key, number: "1", protocol: undefined }],
  ])("treats an authorization with %s as pending", (_label, fields) => {
    expect(acceptProviderStatus({ status: "authorized", ...fields })).toEqual({ status: "pending" });
  });

  it("keeps the rejection reason, limited to 500 characters, and drops fiscal fields on other statuses", () => {
    expect(acceptProviderStatus({ status: "rejected", rejectionReason: "x".repeat(600), accessKey: key })).toEqual({ status: "rejected", rejectionReason: "x".repeat(500) });
  });
});

describe("fiscalFiltersSchema", () => {
  it("falls back to safe defaults", () => {
    expect(fiscalFiltersSchema.parse({ status: "x", storeId: "y", page: "z" })).toEqual({ status: undefined, storeId: undefined, page: 1 });
  });
});
