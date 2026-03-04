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
      if (t1 || t2) {
         matches.push({
           round: round + 1,
           team1: t1 || t2!, // Guarantees team1 is an actual team
           team2: t1 && t2 ? t2 : null // team2 is null if played vs BYE
         });
      }
    }
  }

  return matches;
}
