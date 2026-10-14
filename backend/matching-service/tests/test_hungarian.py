"""Hungarian strategy (spec §10/§22): correctness, 1:1 constraint, and the
greedy-vs-globally-optimal comparison scenario."""

from conftest import NOW, make_donation, make_recipient, make_request, standard_recipients
from greedy import greedy_match
from hungarian import hungarian_match


def total_score(res) -> float:
    return round(sum(a.totalScore for a in res.assignments), 4)


class TestHungarianCorrectness:
    def test_single_donation_matches_best_recipient(self):
        res = hungarian_match(make_request([make_donation("d1")], standard_recipients(), strategy="hungarian"))
        assert len(res.assignments) == 1
        assert res.assignments[0].recipientId == "rec-hope"

    def test_known_optimum_2x2(self):
        """D1 near R1, D2 near R2: optimum is obviously the diagonal."""
        d1 = make_donation("d1", lat=12.970, lng=77.590)
        d2 = make_donation("d2", lat=12.990, lng=77.630)
        r1 = make_recipient("r1", 12.970, 77.5905)
        r2 = make_recipient("r2", 12.990, 77.6295)
        res = hungarian_match(make_request([d1, d2], [r1, r2], strategy="hungarian"))
        by_donation = {a.donationId: a.recipientId for a in res.assignments}
        assert by_donation == {"d1": "r1", "d2": "r2"}

    def test_one_recipient_one_donation_per_cycle(self):
        """Hungarian is 1:1 — one recipient takes at most one donation per cycle."""
        recs = [make_recipient("rec-solo", 12.975, 77.596, capacity=500)]
        donations = [make_donation("d1", expires_in_min=60), make_donation("d2", expires_in_min=300)]
        res = hungarian_match(make_request(donations, recs, strategy="hungarian"))
        assert len(res.assignments) == 1
        assert len(res.waitlisted) == 1

    def test_no_eligible_recipients_waitlists_everything(self):
        res = hungarian_match(
            make_request([make_donation("d1", food="bakery")], standard_recipients(), strategy="hungarian")
        )
        assert res.assignments == []
        assert [w.donationId for w in res.waitlisted] == ["d1"]

    def test_deterministic(self):
        req = make_request(
            [make_donation("d1", expires_in_min=60), make_donation("d2", expires_in_min=200)],
            standard_recipients(),
            strategy="hungarian",
        )
        assert hungarian_match(req) == hungarian_match(req)


class TestGreedyVsHungarian:
    """
    Constructed divergence scenario (collinear geometry):

        D2(late) ---2.28km--- R1 ---0.96km--- D1(urgent) ---0.97km--- R2

    D1 slightly prefers R1. R2 is fine for D1 but poor for D2.
    Greedy (urgent first): D1->R1, D2->R2.
    Global optimum:        D1->R2, D2->R1  (higher total score).

    Capacities (25) force a 1:1 outcome for both strategies here.
    """

    def _scenario(self, strategy: str):
        d1 = make_donation("d1-urgent", qty=20, lat=12.970, lng=77.590, expires_in_min=30)
        d2 = make_donation("d2-late", qty=20, lat=12.970, lng=77.620, expires_in_min=360)
        r1 = make_recipient("r1-mid", 12.970, 77.5989, capacity=25)
        r2 = make_recipient("r2-far-side", 12.970, 77.5810, capacity=25)
        req = make_request([d1, d2], [r1, r2], strategy=strategy)
        return greedy_match(req) if strategy == "greedy" else hungarian_match(req)

    def test_strategies_diverge_and_hungarian_is_globally_better(self):
        greedy_res = self._scenario("greedy")
        hungarian_res = self._scenario("hungarian")

        greedy_pairs = {a.donationId: a.recipientId for a in greedy_res.assignments}
        hungarian_pairs = {a.donationId: a.recipientId for a in hungarian_res.assignments}

        assert greedy_pairs == {"d1-urgent": "r1-mid", "d2-late": "r2-far-side"}
        assert hungarian_pairs == {"d1-urgent": "r2-far-side", "d2-late": "r1-mid"}
        assert total_score(hungarian_res) > total_score(greedy_res)

    def test_both_strategies_waitlist_when_nothing_fits(self):
        for strategy in ("greedy", "hungarian"):
            res = self._scenario(strategy)
            assert len(res.assignments) == 2  # sanity
        none = make_request([make_donation("dX", food="bakery")], standard_recipients(), strategy="hungarian")
        assert hungarian_match(none).assignments == []
