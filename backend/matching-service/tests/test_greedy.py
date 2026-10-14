"""Greedy V1 behaviour (spec §9/§22)."""

import pytest

from conftest import HUB, NOW, make_donation, make_recipient, make_request, standard_recipients
from greedy import greedy_match


class TestBasicGreedy:
    def test_single_donation_picks_best_eligible_recipient(self):
        req = make_request([make_donation("d1")], standard_recipients())
        res = greedy_match(req)
        assert len(res.assignments) == 1
        assert res.assignments[0].donationId == "d1"
        assert res.assignments[0].recipientId == "rec-hope"  # closest + large headroom

    def test_score_explanation_shape(self):
        req = make_request([make_donation("d1")], standard_recipients())
        a = greedy_match(req).assignments[0]
        for field in ("totalScore", "urgencyScore", "proximityScore", "capacityScore", "distanceKm"):
            assert getattr(a, field) is not None
        assert 0.0 <= a.urgencyScore <= 1.0
        assert 0.0 <= a.proximityScore <= 1.0
        assert 0.0 <= a.capacityScore <= 1.0

    def test_zero_eligible_recipients_waitlists(self):
        # Nobody accepts 'bakery'
        req = make_request([make_donation("d1", food="bakery")], standard_recipients())
        res = greedy_match(req)
        assert res.assignments == []
        assert [w.donationId for w in res.waitlisted] == ["d1"]
        assert res.waitlisted[0].maxRadiusKmTried == 25.0

    def test_deterministic_for_identical_input(self):
        req = make_request(
            [make_donation("d1"), make_donation("d2", qty=10, expires_in_min=90)],
            standard_recipients(),
        )
        assert greedy_match(req) == greedy_match(req)


class TestHardFilters:
    def test_inactive_recipient_filtered(self):
        foodbank_only = [make_recipient("rec-foodbank", 12.96, 77.59, prefs=("cooked_meals",), active=False)]
        res = greedy_match(make_request([make_donation("d1")], foodbank_only))
        assert res.assignments == []
        expl = res.explanations[0]
        assert expl.outcome == "WAITLISTED"
        assert any("inactive" in r for c in expl.candidates for r in c.reasons)

    def test_capacity_filter(self):
        tiny = [make_recipient("rec-tiny", HUB[0], HUB[1], capacity=15, assigned=5)]
        res = greedy_match(make_request([make_donation("d1", qty=20)], tiny))
        assert res.assignments == []
        assert any("capacity" in r for c in res.explanations[0].candidates for r in c.reasons)

    def test_food_incompatibility_filtered(self):
        veg_only = [make_recipient("rec-veg", HUB[0], HUB[1], prefs=("packaged",))]
        res = greedy_match(make_request([make_donation("d1", food="cooked_meals")], veg_only))
        assert res.assignments == []
        assert any("food type" in r for c in res.explanations[0].candidates for r in c.reasons)

    def test_dietary_restriction_filtered(self):
        # SRS NFR-7: accepts everything (no prefs) but declares a restriction
        restricted = [make_recipient("rec-nodairy", HUB[0], HUB[1], restrictions=("DAIRY",))]
        res = greedy_match(make_request([make_donation("d1", food="dairy")], restricted))
        assert res.assignments == []
        assert any("dietary restriction" in r for c in res.explanations[0].candidates for r in c.reasons)

    def test_dietary_restriction_does_not_block_other_food(self):
        restricted = [make_recipient("rec-nodairy", HUB[0], HUB[1], restrictions=("dairy",))]
        res = greedy_match(make_request([make_donation("d1", food="cooked_meals")], restricted))
        assert len(res.assignments) == 1

    def test_spatial_radius_filter(self):
        far = [make_recipient("rec-far", 13.5, 78.0, radius=50)]  # > 60 km away
        res = greedy_match(make_request([make_donation("d1")], far))
        assert res.assignments == []
        assert any("radius" in r for c in res.explanations[0].candidates for r in c.reasons)

    def test_expired_donation_waitlisted_via_pickup_window(self):
        expired = make_donation("d-exp", expires_in_min=10)  # < 30 min feasibility window
        res = greedy_match(make_request([expired], standard_recipients()))
        assert res.assignments == []
        assert any("pickup not realistic" in r for c in res.explanations[0].candidates for r in c.reasons)

    def test_pickup_end_window_respected(self):
        soon = make_donation("d1", expires_in_min=300, pickup_end_in_min=15)
        res = greedy_match(make_request([soon], standard_recipients()))
        assert res.assignments == []


class TestRadiusExpansionAndWaitlist:
    def test_radius_expansion_finds_recipient_beyond_initial_radius(self):
        # 12 km away: outside initial 5 km, inside max 25 km
        mid = [make_recipient("rec-mid", 13.05, 77.65, radius=25)]
        res = greedy_match(make_request([make_donation("d1")], mid))
        assert res.assignments[0].recipientId == "rec-mid"
        assert res.assignments[0].searchRadiusKmUsed > 5.0  # expansion actually happened

    def test_waitlist_when_beyond_max_radius(self):
        far = [make_recipient("rec-far", 13.5, 78.0, radius=100)]
        res = greedy_match(make_request([make_donation("d1")], far))
        assert res.assignments == []
        assert res.waitlisted[0].donationId == "d1"


class TestMultiDonationGreedy:
    def test_near_expiry_donation_processed_first(self):
        """Single recipient that can serve only one donation; the near-expiry
        donation must win the capacity because it is processed first."""
        recipient = [make_recipient("rec-only", 12.975, 77.596, capacity=25, assigned=0)]
        urgent = make_donation("d-urgent", qty=20, expires_in_min=40)
        late = make_donation("d-late", qty=20, expires_in_min=300)
        res = greedy_match(make_request([late, urgent], recipient))  # input order shuffled on purpose
        assert [(a.donationId, a.recipientId) for a in res.assignments] == [("d-urgent", "rec-only")]
        assert [w.donationId for w in res.waitlisted] == ["d-late"]

    def test_multiple_simultaneous_donations_share_capacity(self):
        res = greedy_match(
            make_request(
                [make_donation("d1", qty=20, expires_in_min=60), make_donation("d2", qty=20, expires_in_min=120)],
                standard_recipients(),
            )
        )
        assert len(res.assignments) == 2
        # d1 (more urgent) is processed first and takes rec-hope; the capacity
        # reservation shifts d2 to the next-best recipient.
        by_donation = {a.donationId: a.recipientId for a in res.assignments}
        assert by_donation == {"d1": "rec-hope", "d2": "rec-sunrise"}

    def test_single_recipient_contention_resolves_to_more_urgent(self):
        recs = [make_recipient("rec-a", 12.975, 77.596, capacity=30)]
        d1 = make_donation("d1", qty=25, expires_in_min=50)
        d2 = make_donation("d2", qty=25, expires_in_min=200)
        res = greedy_match(make_request([d2, d1], recs))
        assert [a.donationId for a in res.assignments] == ["d1"]
        assert [w.donationId for w in res.waitlisted] == ["d2"]


class TestRejectionRematching:
    def test_excluded_recipient_is_skipped(self):
        from models import Exclusion

        req = make_request(
            [make_donation("d1")],
            standard_recipients(),
            exclusions=[Exclusion(donationId="d1", recipientId="rec-hope")],
        )
        res = greedy_match(req)
        assert res.assignments[0].recipientId != "rec-hope"
        assert any(
            "previously rejected" in r
            for c in res.explanations[0].candidates
            if c.recipientId == "rec-hope"
            for r in c.reasons
        )


class TestPairDistancesFromPostGIS:
    def test_precomputed_postgis_distances_are_used(self):
        from models import PairDistance

        # Lie about the distance via pairDistances: rec-far claims to be 1 km away.
        req = make_request([make_donation("d1")], [make_recipient("rec-far", 13.5, 78.0)])
        req.pairDistances = [PairDistance(donationId="d1", recipientId="rec-far", distanceKm=1.0)]
        res = greedy_match(req)
        assert res.assignments[0].recipientId == "rec-far"
        assert res.assignments[0].distanceKm == pytest.approx(1.0)
