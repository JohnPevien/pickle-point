import { create } from 'zustand';

interface CourtState {
  id: string;
  name: string;
  status: 'available' | 'in_progress' | 'awaiting_score';
}

interface MatchState {
  id: string;
  team1Id: string | null;
  team2Id: string | null;
  courtId: string | null;
  score1: number | null;
  score2: number | null;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TournamentStore {
  activeTournamentId: string | null;
  tenantId: string | null;
  courts: CourtState[];
  activeMatches: MatchState[];
  
  // Actions
  setActiveTournament: (tenantId: string, tournamentId: string) => void;
  setCourts: (courts: CourtState[]) => void;
  updateCourtStatus: (courtId: string, status: CourtState['status']) => void;
  
  setMatches: (matches: MatchState[]) => void;
  updateMatchStatus: (matchId: string, status: MatchState['status'], courtId: string | null) => void;
  recordScore: (matchId: string, score1: number, score2: number) => void;
}

export const useTournamentStore = create<TournamentStore>((set) => ({
  activeTournamentId: null,
  tenantId: null,
  courts: [],
  activeMatches: [],

  setActiveTournament: (tenantId, tournamentId) => set({ tenantId, activeTournamentId: tournamentId }),
  
  setCourts: (courts) => set({ courts }),
  updateCourtStatus: (courtId, status) =>
    set((state) => ({
      courts: state.courts.map((court) =>
        court.id === courtId ? { ...court, status } : court
      ),
    })),

  setMatches: (matches) => set({ activeMatches: matches }),
  updateMatchStatus: (matchId, status, courtId) =>
    set((state) => ({
      activeMatches: state.activeMatches.map((match) =>
        match.id === matchId ? { ...match, status, courtId } : match
      ),
    })),
    
  recordScore: (matchId, score1, score2) =>
    set((state) => ({
      activeMatches: state.activeMatches.map((match) =>
        match.id === matchId ? { ...match, score1, score2, status: 'completed' } : match
      ),
    })),
}));
