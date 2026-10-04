'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  approveProposalAction,
  rejectProposalAction,
  editProposalAction,
} from '@/lib/actions/trading.actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ProposalCard = {
  _id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty?: number;
  notional?: number;
  entry: number;
  stop: number;
  target: number;
  maxSlippageBps: number;
  rationale: string;
  status: string;
  paper: boolean;
  rMultiple?: number;
  riskNotes?: string[];
  expiresAt?: string;
};

export function ApprovalModal({
  proposal,
  open,
  onOpenChange,
}: {
  proposal: ProposalCard | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [entry, setEntry] = useState(proposal?.entry ?? 0);
  const [stop, setStop] = useState(proposal?.stop ?? 0);
  const [target, setTarget] = useState(proposal?.target ?? 0);
  const [qty, setQty] = useState(proposal?.qty ?? 1);
  const [livePhrase, setLivePhrase] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (proposal) {
      setEntry(proposal.entry);
      setStop(proposal.stop);
      setTarget(proposal.target);
      setQty(proposal.qty ?? 1);
      setLivePhrase('');
    }
  }, [proposal]);

  if (!proposal) return null;

  const notional = (qty || 0) * entry;
  const risk = Math.abs(entry - stop) || 1;
  const rMultiple = Math.abs(target - entry) / risk;

  const onApprove = () => {
    startTransition(async () => {
      try {
        // Persist edits first if changed
        if (
          entry !== proposal.entry ||
          stop !== proposal.stop ||
          target !== proposal.target ||
          qty !== proposal.qty
        ) {
          await editProposalAction(proposal._id, { entry, stop, target, qty });
        }
        const res = await approveProposalAction(proposal._id, {
          qty,
          liveConfirmPhrase: livePhrase || undefined,
        });
        if (res.ok) {
          toast.success(`${proposal.symbol} order submitted (${proposal.paper ? 'paper' : 'live'})`);
        } else {
          toast.message(res.error || 'Approved without submit');
        }
        onOpenChange(false);
      } catch (e) {
        toast.error(String(e));
      }
    });
  };

  const onReject = () => {
    startTransition(async () => {
      try {
        await rejectProposalAction(proposal._id, 'Rejected from approval modal');
        toast.message(`Rejected ${proposal.symbol}`);
        onOpenChange(false);
      } catch (e) {
        toast.error(String(e));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Approve {proposal.side.toUpperCase()} {proposal.symbol}?
          </DialogTitle>
          <DialogDescription>
            No order is sent until you click Approve. Default mode is paper trading.
            {proposal.paper ? ' (PAPER)' : ' (LIVE)'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="entry">Entry / limit</Label>
              <Input id="entry" type="number" step="0.01" value={entry} onChange={(e) => setEntry(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="qty">Qty</Label>
              <Input id="qty" type="number" step="1" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="stop">Stop</Label>
              <Input id="stop" type="number" step="0.01" value={stop} onChange={(e) => setStop(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="target">Target</Label>
              <Input id="target" type="number" step="0.01" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Est. notional <span className="font-semibold text-foreground">${notional.toFixed(2)}</span>
            {' · '}R-multiple <span className="font-semibold text-foreground">{rMultiple.toFixed(2)}R</span>
            {' · '}max slippage {proposal.maxSlippageBps} bps
          </p>

          {proposal.riskNotes && proposal.riskNotes.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {proposal.riskNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <p className="text-sm leading-relaxed">{proposal.rationale}</p>

          {!proposal.paper && (
            <div>
              <Label htmlFor="live">Live confirm phrase</Label>
              <Input
                id="live"
                placeholder="Type LIVE to confirm"
                value={livePhrase}
                onChange={(e) => setLivePhrase(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={pending} onClick={onReject}>
            Reject
          </Button>
          <Button type="button" disabled={pending} onClick={onApprove}>
            {pending ? 'Working…' : 'Approve & submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
