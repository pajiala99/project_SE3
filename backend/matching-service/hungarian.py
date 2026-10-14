"""Hungarian strategy (spec §10) — globally optimal 1:1 assignment for a
matching cycle, via scipy.optimize.linear_sum_assignment (we deliberately do
NOT hand-code the algorithm).

- Cost matrix: D donations x R recipients; entry = weighted score for eligible
  pairs at max search radius, -1 for ineligible pairs.
- linear_sum_assignment(maximize=True) maximises total score.
- Pairs scoring < 0 are discarded (ineligible); donations left unassigned are
  waitlisted (never silently dropped).
- Deterministic: input rows/cols are sorted by id before matrix construction.
- Complexity: ~O(n^3) for an n x n assignment (n = max(D, R) after padding).

Constraint documented for the final report: Hungarian assigns at most one
donation per recipient per cycle (1:1), unlike greedy which can split a
recipient's capacity across donations. For multi-serving splitting, greedy
remains the default for the mid-semester demo.
"""

from typing import Dict, List, Set, Tuple

import numpy as np
from scipy.optimize import linear_sum_assignment

from filtering import eligible_at_radius, minutes_until_expiry
from models import (
    Assignment,
    CandidateExplanation,
    DonationExplanation,
    MatchRequest,
    MatchResponse,
    PairDistanceMap,
    Waitlisted,
)
from scoring import score_pair


def hungarian_match(request: MatchRequest) -> MatchResponse:
    config = request.config
    now = request.now
    excluded: Set[Tuple[str, str]] = {(e.donationId, e.recipientId) for e in request.exclusions}
    pair_distances: PairDistanceMap = {
        (p.donationId, p.recipientId): p.distanceKm for p in request.pairDistances
    }

    donations = sorted(request.donations, key=lambda d: d.donationId)
    recipients = sorted(request.recipients, key=lambda r: r.recipientId)

    # Eligibility + score matrix at max radius (Hungarian needs the full
    # bipartite picture; progressive expansion is a greedy-cycle behaviour).
    eligible_map: Dict[Tuple[str, str], Tuple[float, float, float, float, float]] = {}
    explanations_map: Dict[str, List[CandidateExplanation]] = {}
    for donation in donations:
        eligible, cand_explanations = eligible_at_radius(
            donation, recipients, config.maxRadiusKm, {}, excluded, pair_distances, config, now,
        )
        expiry_minutes = minutes_until_expiry(donation, now)
        scored_candidates: List[CandidateExplanation] = []
        for recipient, distance in eligible:
            total, u, p, c = score_pair(donation, recipient, distance, expiry_minutes, config)
            eligible_map[(donation.donationId, recipient.recipientId)] = (total, u, p, c, distance)
            scored_candidates.append(
                CandidateExplanation(
                    recipientId=recipient.recipientId,
                    eligible=True,
                    reasons=[],
                    totalScore=total,
                    proximityScore=p,
                    capacityScore=c,
                    distanceKm=round(distance, 4),
                )
            )
        explanations_map[donation.donationId] = scored_candidates + cand_explanations

    if not donations or not recipients:
        return MatchResponse(
            strategy="hungarian",
            assignments=[],
            waitlisted=[
                Waitlisted(
                    donationId=d.donationId,
                    reason="no recipients available at all" if not recipients else "no eligible recipient",
                    maxRadiusKmTried=config.maxRadiusKm,
                )
                for d in donations
            ],
            explanations=[
                DonationExplanation(
                    donationId=d.donationId,
                    outcome="WAITLISTED",
                    candidates=explanations_map.get(d.donationId, []),
                )
                for d in donations
            ],
        )

    d_n, r_n = len(donations), len(recipients)
    n = max(d_n, r_n)
    matrix = np.full((n, n), -1.0)
    for i, donation in enumerate(donations):
        for j, recipient in enumerate(recipients):
            entry = eligible_map.get((donation.donationId, recipient.recipientId))
            if entry is not None:
                matrix[i, j] = entry[0]

    rows, cols = linear_sum_assignment(matrix, maximize=True)

    assignments: List[Assignment] = []
    assigned_donations: Set[str] = set()
    for i, j in zip(rows.tolist(), cols.tolist()):
        if i >= d_n or j >= r_n:
            continue  # padded row/col
        donation = donations[i]
        recipient = recipients[j]
        entry = eligible_map.get((donation.donationId, recipient.recipientId))
        if entry is None:
            continue  # ineligible pairing chosen only because of padding
        total, u, p, c, distance = entry
        assigned_donations.add(donation.donationId)
        assignments.append(
            Assignment(
                donationId=donation.donationId,
                recipientId=recipient.recipientId,
                totalScore=total,
                urgencyScore=u,
                proximityScore=p,
                capacityScore=c,
                distanceKm=round(distance, 4),
                searchRadiusKmUsed=config.maxRadiusKm,
            )
        )

    waitlisted: List[Waitlisted] = []
    explanations: List[DonationExplanation] = []
    for donation in donations:
        if donation.donationId in assigned_donations:
            explanations.append(
                DonationExplanation(
                    donationId=donation.donationId,
                    outcome="MATCHED",
                    candidates=explanations_map.get(donation.donationId, []),
                )
            )
        else:
            waitlisted.append(
                Waitlisted(
                    donationId=donation.donationId,
                    reason="no eligible recipient after global assignment; stays POSTED for retry",
                    maxRadiusKmTried=config.maxRadiusKm,
                )
            )
            explanations.append(
                DonationExplanation(
                    donationId=donation.donationId,
                    outcome="WAITLISTED",
                    candidates=explanations_map.get(donation.donationId, []),
                )
            )

    return MatchResponse(
        strategy="hungarian",
        assignments=assignments,
        waitlisted=waitlisted,
        explanations=explanations,
    )
