"""GREEDY V1 — the canonical first matching strategy (spec §9).

For all active POSTED donations:

1. compute remaining time-to-expiry for each donation
2. sort by urgency, MOST URGENT first (tie-break: donation id) — this is how
   urgency enters greedy: it decides which donation is processed first
3. find eligible recipients (hard filters, with progressive radius expansion)
4. score candidates with proximity + capacity/need (+ donation urgency as a
   weighted component of the total)
5. assign the highest-scoring recipient with remaining capacity
6. reserve that capacity within the cycle and continue

Deterministic for identical input. Practical complexity: O(D log D) for the
urgency sort, then O(D * R) filter+score in the worst case (each donation
scans all R recipients), with radius expansion multiplying the scan by a
small constant number of radius steps. Cheap for academic/city scale.
"""

from datetime import datetime
from typing import Dict, List, Set, Tuple

from filtering import expand_radius_until_eligible, minutes_until_expiry
from models import (
    Assignment,
    CandidateExplanation,
    DonationExplanation,
    DonationIn,
    MatchConfig,
    MatchRequest,
    MatchResponse,
    PairDistanceMap,
    RecipientIn,
    Waitlisted,
)
from scoring import score_pair


def greedy_match(request: MatchRequest) -> MatchResponse:
    config = request.config
    now = request.now
    excluded: Set[Tuple[str, str]] = {(e.donationId, e.recipientId) for e in request.exclusions}
    pair_distances: PairDistanceMap = {
        (p.donationId, p.recipientId): p.distanceKm for p in request.pairDistances
    }
    recipients: List[RecipientIn] = request.recipients

    # Most urgent first; deterministic tie-break by id.
    donations = sorted(
        request.donations,
        key=lambda d: (minutes_until_expiry(d, now), d.donationId),
    )

    reserved: Dict[str, float] = {}  # servings reserved per recipient this cycle
    assignments: List[Assignment] = []
    waitlisted: List[Waitlisted] = []
    explanations: List[DonationExplanation] = []

    for donation in donations:
        eligible, radius_used, cand_explanations = expand_radius_until_eligible(
            donation, recipients, reserved, excluded, pair_distances, config, now,
        )
        expiry_minutes = minutes_until_expiry(donation, now)

        if not eligible:
            explanations.append(
                DonationExplanation(
                    donationId=donation.donationId, outcome="WAITLISTED", candidates=cand_explanations,
                )
            )
            waitlisted.append(
                Waitlisted(
                    donationId=donation.donationId,
                    reason="no eligible recipient within expanded search radius "
                    f"({config.maxRadiusKm:.0f} km); donation stays POSTED for retry",
                    maxRadiusKmTried=config.maxRadiusKm,
                )
            )
            continue

        best = None  # (total, urgency, proximity, capacity, distance, recipient)
        best_candidates: List[CandidateExplanation] = []
        scored: List[Tuple[float, float, float, float, float, RecipientIn]] = []
        for recipient, distance in eligible:
            total, u, p, c = score_pair(
                donation, recipient, distance, expiry_minutes, config,
                reserved.get(recipient.recipientId, 0.0),
            )
            scored.append((total, u, p, c, distance, recipient))

        # deterministic: highest score, then smallest recipient id
        scored.sort(key=lambda t: (-t[0], t[5].recipientId))
        best = scored[0]

        for total, _u, _p, c, distance, recipient in scored:
            best_candidates.append(
                CandidateExplanation(
                    recipientId=recipient.recipientId,
                    eligible=True,
                    reasons=[],
                    totalScore=total,
                    proximityScore=_p,
                    capacityScore=c,
                    distanceKm=round(distance, 4),
                )
            )

        total, u, p, c, distance, recipient = best
        assignments.append(
            Assignment(
                donationId=donation.donationId,
                recipientId=recipient.recipientId,
                totalScore=total,
                urgencyScore=u,
                proximityScore=p,
                capacityScore=c,
                distanceKm=round(distance, 4),
                searchRadiusKmUsed=radius_used,
            )
        )
        reserved[recipient.recipientId] = reserved.get(recipient.recipientId, 0.0) + donation.quantityServings
        explanations.append(
            DonationExplanation(
                donationId=donation.donationId,
                outcome="MATCHED",
                # scored eligible candidates first, then filtered-out candidates
                # with their rejection reasons (full audit trail).
                candidates=best_candidates + cand_explanations,
            )
        )

    return MatchResponse(
        strategy="greedy",
        assignments=assignments,
        waitlisted=waitlisted,
        explanations=explanations,
    )
