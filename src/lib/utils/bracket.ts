// Assuming a simplified structure for the algorithm processing

export type TeamMinimal = {
  id: string;
  name: string;
};

export type Match = {
  round: number;
  team1: TeamMinimal;
  team2: TeamMinimal | null; // null represents a "Bye"
};

/**
 * Generates a Round Robin schedule using the standard circle method.
 * If the number of teams is odd, a dummy "Bye" team is injected,
 * and anyone playing the "Bye" team gets that round off.
 * 
 * @param teams Array of teams to schedule
 * @returns Array of matches organized by round
 */
export function generateRoundRobinMatches(teams: TeamMinimal[]): Match[] {
  if (!teams || teams.length < 2) {
    return [];
  }

  const matches: Match[] = [];
  const teamsArray = [...teams];

  // If odd number of teams, add a dummy "Bye" team denoted by null id
  if (teamsArray.length % 2 !== 0) {
    teamsArray.push({ id: "BYE", name: "Bye" });
  }

  const numTeams = teamsArray.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;

  // We keep the first team fixed (teamsArray[0]) and rotate the rest
  for (let round = 0; round < numRounds; round++) {
    for (let match = 0; match < matchesPerRound; match++) {
      const home = (round + match) % (numTeams - 1);
      let away = (numTeams - 1 - match + round) % (numTeams - 1);

      // Special case: the last team stays fixed, played against 'home' when match === 0
      if (match === 0) {
        away = numTeams - 1;
      }

      const team1 = teamsArray[home];
      const team2 = teamsArray[away];

      // Exclude matches against the dummy "BYE" team from the actual schedule if desired,
      // but keeping it explicit helps UI show who has a BYE.
      // We will map BYE's to null team2 for the UI.
      
      const t1 = team1.id === "BYE" ? null : team1;
      const t2 = team2.id === "BYE" ? null : team2;

      // Only add if at least one actual team is playing
      // Only generate a real match if team1 isn't a Bye (which shouldn't happen based on dummy logic, but safe to check) and team2 isn't a Bye.
      // Actually, if we hit a Dummy, we either map to null (Bye) or actual team.
      const matchTeam1 = t1 && t1.id !== "dummy" ? t1 : null;
      const matchTeam2 = t2 && t2.id !== "dummy" ? t2 : null;

      // If both are null (Dummy vs Dummy), we skip.
      if (!matchTeam1 && !matchTeam2) continue;

      // We need a guaranteed actual team for team1 to satisfy the Match type
      let finalTeam1 = matchTeam1;
      let finalTeam2 = matchTeam2;

      // If team1 is null (a BYE Dummy) and team2 is an actual team, swap them
      // so the actual team is always team1 and team2 is the BYE (null).
      if (!finalTeam1 && finalTeam2) {
        finalTeam1 = finalTeam2;
        finalTeam2 = null;
      }
      
      // If after swap, we still don't have a team1, skip the match
      if (!finalTeam1) continue;

      matches.push({
        round: round + 1,
        team1: finalTeam1,
        team2: finalTeam2,
      });
    }
  }

  return matches;
}
