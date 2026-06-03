"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, ArrowLeftRight, UserMinus, X } from "lucide-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getActivePlayerIds, playerName } from "@/lib/open-play/helpers";
import type { LiveMatch, SessionPlayerRow } from "@/lib/open-play/types";

type MatchAdjustPanelProps = {
  match: LiveMatch;
  sessionPlayers: SessionPlayerRow[];
  activeMatches: LiveMatch[];
};

/**
 * Inline Game Master controls for an active match:
 * rename court, swap players, substitute player, cancel match.
 */
export function MatchAdjustPanel({ match, sessionPlayers, activeMatches }: MatchAdjustPanelProps) {
  const [open, setOpen] = useState(false);

  const updateMatchCourt = useMutation(api.openPlaySessions.updateMatchCourt);
  const swapMatchPlayers = useMutation(api.openPlaySessions.swapMatchPlayers);
  const substituteMatchPlayer = useMutation(api.openPlaySessions.substituteMatchPlayer);
  const cancelMatch = useMutation(api.openPlaySessions.cancelMatch);
  const [isPending, startTransition] = useTransition();

  // Court rename — keep the local input in sync if the match is renamed elsewhere
  // (another admin, a Convex subscription update, etc.) so a stale Rename submit
  // can't silently overwrite the live value.
  const [courtName, setCourtName] = useState(match.courtName ?? "");
  useEffect(() => {
    setCourtName(match.courtName ?? "");
  }, [match.courtName]);

  // Swap players
  const allMatchPlayers = [...match.team1Details, ...match.team2Details];
  // Radix Select's onValueChange is typed (value: string) => void, so we keep
  // the state as a plain string and narrow at submit time.
  const [swapA, setSwapA] = useState<string>("");
  const [swapB, setSwapB] = useState<string>("");

  // Substitute
  const activePlayerIds = getActivePlayerIds(activeMatches);
  const [outgoing, setOutgoing] = useState<string>("");
  const [incoming, setIncoming] = useState<string>("");

  const substituteEligible = sessionPlayers.filter(
    (sp) =>
      (sp.status === "queued" || sp.status === "sitting_out") &&
      !activePlayerIds.has(sp.playerId)
  );

  function submitCourtRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateMatchCourt({ matchId: match._id, courtName });
      if (result.success) {
        toast.success("Court renamed.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitSwap(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!swapA || !swapB || swapA === swapB) {
      toast.error("Select two different players to swap.");
      return;
    }
    startTransition(async () => {
      const result = await swapMatchPlayers({
        matchId: match._id,
        playerAId: swapA as Id<"players">,
        playerBId: swapB as Id<"players">,
      });
      if (result.success) {
        setSwapA("");
        setSwapB("");
        toast.success("Players swapped.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitSubstitute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!outgoing || !incoming) {
      toast.error("Select both outgoing and incoming players.");
      return;
    }
    startTransition(async () => {
      const result = await substituteMatchPlayer({
        matchId: match._id,
        outgoingPlayerId: outgoing as Id<"players">,
        incomingPlayerId: incoming as Id<"players">,
      });
      if (result.success) {
        setOutgoing("");
        setIncoming("");
        toast.success("Substitution complete.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitCancel() {
    if (!confirm(`Cancel match on ${match.courtName ?? "this court"}? Players will return to queue.`)) {
      return;
    }
    startTransition(async () => {
      const result = await cancelMatch({ matchId: match._id });
      if (result.success) {
        toast.success("Match cancelled. Players returned to queue.");
      } else {
        toast.error(result.error);
      }
    });
  }

  const isScored = match.score1 != null || match.score2 != null;

  return (
    <div className="mt-3 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        id={`match-adjust-toggle-${match._id}`}
      >
        <span>Adjust match</span>
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Rename court */}
          <form onSubmit={submitCourtRename} className="flex gap-2">
            <Input
              value={courtName}
              onChange={(e) => setCourtName(e.target.value)}
              placeholder="Court name"
              aria-label="Rename court"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={isPending} className="h-8 shrink-0">
              Rename
            </Button>
          </form>

          {/* Swap players */}
          <form onSubmit={submitSwap} className="space-y-2">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ArrowLeftRight className="size-3" /> Swap within match
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={swapA} onValueChange={setSwapA}>
                <SelectTrigger className="h-8 text-xs" aria-label="Player A for swap">
                  <SelectValue placeholder="Player A" />
                </SelectTrigger>
                <SelectContent>
                  {allMatchPlayers.map((p) =>
                    p ? (
                      <SelectItem key={p._id} value={p._id} className="text-xs">
                        {playerName(p)}
                      </SelectItem>
                    ) : null
                  )}
                </SelectContent>
              </Select>
              <Select value={swapB} onValueChange={setSwapB}>
                <SelectTrigger className="h-8 text-xs" aria-label="Player B for swap">
                  <SelectValue placeholder="Player B" />
                </SelectTrigger>
                <SelectContent>
                  {allMatchPlayers.map((p) =>
                    p ? (
                      <SelectItem key={p._id} value={p._id} className="text-xs">
                        {playerName(p)}
                      </SelectItem>
                    ) : null
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={isPending || !swapA || !swapB || swapA === swapB}
              className="h-8 w-full"
            >
              Swap
            </Button>
          </form>

          {/* Substitute player */}
          <form onSubmit={submitSubstitute} className="space-y-2">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <UserMinus className="size-3" /> Substitute
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={outgoing} onValueChange={setOutgoing} disabled={isScored}>
                <SelectTrigger className="h-8 text-xs" aria-label="Outgoing player for substitution">
                  <SelectValue placeholder="Remove" />
                </SelectTrigger>
                <SelectContent>
                  {allMatchPlayers.map((p) =>
                    p ? (
                      <SelectItem key={p._id} value={p._id} className="text-xs">
                        {playerName(p)}
                      </SelectItem>
                    ) : null
                  )}
                </SelectContent>
              </Select>
              <Select value={incoming} onValueChange={setIncoming} disabled={isScored}>
                <SelectTrigger className="h-8 text-xs" aria-label="Incoming substitute player">
                  <SelectValue placeholder="Add in" />
                </SelectTrigger>
                <SelectContent>
                  {substituteEligible.map((sp) => (
                    <SelectItem key={sp._id} value={sp.playerId} className="text-xs">
                      {playerName(sp.playerDetails)}
                      {sp.status === "sitting_out" ? " (out)" : ""}
                    </SelectItem>
                  ))}
                  {substituteEligible.length === 0 && (
                    <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                      No eligible players
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {isScored && (
              <p className="text-xs text-amber-600">Cannot substitute after scoring.</p>
            )}
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={isPending || isScored || !outgoing || !incoming}
              className="h-8 w-full"
            >
              Substitute
            </Button>
          </form>

          {/* Cancel match */}
          <div className="border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || isScored}
              onClick={submitCancel}
              className="h-8 w-full border-destructive/40 text-destructive hover:bg-destructive/10"
              id={`match-cancel-btn-${match._id}`}
            >
              <X className="size-3.5" />
              Cancel match
            </Button>
            {isScored && (
              <p className="mt-1 text-center text-xs text-muted-foreground">Cannot cancel a scored match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
