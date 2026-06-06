import { describe, expect, test } from "vitest";
import { filterPlayers, sortPlayersByName, type PlayerDirectoryRow } from "./admin";

const players: PlayerDirectoryRow[] = [
  {
    firstName: "Ada",
    lastName: "Lovelace",
    skillSource: "dupr",
    manualSkillLevel: "Advanced",
    duprRating: 4.72,
    username: "ada",
    email: "ada@example.com",
  },
  {
    firstName: "Grace",
    lastName: "Hopper",
    skillSource: "manual",
    manualSkillLevel: "Low Intermediate",
    phone: "5551234567",
  },
  {
    firstName: "Katherine",
    lastName: "Johnson",
    skillSource: "manual",
    manualSkillLevel: "Advanced",
    email: "kat@example.com",
  },
];

describe("player admin helpers", () => {
  test("sorts players by display name", () => {
    expect(sortPlayersByName([players[1], players[0]]).map((player) => player.firstName)).toEqual([
      "Ada",
      "Grace",
    ]);
  });

  test("searches name and contact fields", () => {
    const byName = filterPlayers(players, {
      search: "hopper",
      skillSource: "all",
      manualSkillLevel: "all",
      duprPresence: "all",
    });
    expect(byName).toHaveLength(1);
    expect(byName[0].firstName).toBe("Grace");

    const byContact = filterPlayers(players, {
      search: "kat@example",
      skillSource: "all",
      manualSkillLevel: "all",
      duprPresence: "all",
    });
    expect(byContact).toHaveLength(1);
    expect(byContact[0].firstName).toBe("Katherine");
  });

  test("filters by skill source, manual level, and DUPR presence", () => {
    const filtered = filterPlayers(players, {
      search: "",
      skillSource: "manual",
      manualSkillLevel: "Advanced",
      duprPresence: "without",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].firstName).toBe("Katherine");
  });
});
