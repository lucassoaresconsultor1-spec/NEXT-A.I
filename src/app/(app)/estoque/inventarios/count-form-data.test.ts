import { describe, expect, it } from "vitest";
import { itemFieldErrors, readCountedItems } from "./count-form-data";

describe("count form data", () => {
  it("reads only the filled quantity fields", () => {
    const formData = new FormData();
    formData.set("countId", "c1");
    formData.set("qty:a", " 2,5 ");
    formData.set("qty:b", "");
    formData.set("qty:c", "0");
    expect(readCountedItems(formData)).toEqual([
      { itemId: "a", countedQuantity: "2,5" },
      { itemId: "c", countedQuantity: "0" },
    ]);
  });

  it("maps service errors to the field of the item", () => {
    const items = [{ itemId: "a" }, { itemId: "c" }];
    expect(itemFieldErrors({ "items.1.countedQuantity": ["Somente números inteiros."], items: ["x"] }, items)).toEqual({
      "qty:c": ["Somente números inteiros."],
      items: ["x"],
    });
    expect(itemFieldErrors(undefined, items)).toBeUndefined();
  });
});
