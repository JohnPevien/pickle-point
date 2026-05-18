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

const BYE_TEAM_ID = "BYE";

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

  // If odd number of teams, add a dummy "Bye" team.
  if (teamsArray.length % 2 !== 0) {
    teamsArray.push({ id: BYE_TEAM_ID, name: "Bye" });
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
      
      const actualTeam1 = team1.id === BYE_TEAM_ID ? null : team1;
      const actualTeam2 = team2.id === BYE_TEAM_ID ? null : team2;

      if (!actualTeam1 && !actualTeam2) continue;

      if (!actualTeam1) {
        if (!actualTeam2) continue;

        matches.push({
          round: round + 1,
          team1: actualTeam2,
          team2: null,
        });
        continue;
      }

      matches.push({
        round: round + 1,
        team1: actualTeam1,
        team2: actualTeam2,
      });
    }
  }

  return matches;
}
