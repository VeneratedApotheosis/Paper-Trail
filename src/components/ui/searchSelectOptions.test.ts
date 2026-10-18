import { expect, it } from "vitest";
import { filterSearchSelectOptions, type SearchSelectOption } from "./searchSelectOptions";

const options: SearchSelectOption[] = [
  { value: "Harbor Supply Co.", label: "Harbor Supply Co.", count: 3 },
  { value: "Rowan and Vale", label: "Rowan and Vale", count: 1 },
  { value: "Atlas Outdoor", label: "Atlas Outdoor", count: 2 },
];

it("keeps every option for a blank query", () => {
  expect(filterSearchSelectOptions(options, "")).toEqual(options);
  expect(filterSearchSelectOptions(options, "   ")).toEqual(options);
});

it("matches case-insensitively anywhere in the label", () => {
  expect(filterSearchSelectOptions(options, "ROWAN").map((o) => o.value)).toEqual(["Rowan and Vale"]);
  expect(filterSearchSelectOptions(options, "supply").map((o) => o.value)).toEqual(["Harbor Supply Co."]);
  expect(filterSearchSelectOptions(options, "out").map((o) => o.value)).toEqual(["Atlas Outdoor"]);
  expect(filterSearchSelectOptions(options, " an ").map((o) => o.value)).toEqual(["Rowan and Vale"]);
});

it("returns nothing when no label matches and keeps original order otherwise", () => {
  expect(filterSearchSelectOptions(options, "zzz")).toEqual([]);
  expect(filterSearchSelectOptions(options, "a").map((o) => o.value)).toEqual([
    "Harbor Supply Co.",
    "Rowan and Vale",
    "Atlas Outdoor",
  ]);
});