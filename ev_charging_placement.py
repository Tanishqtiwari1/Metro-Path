"""
Real-Life Application 2: EV Charging Station Placement using Hill Climbing

Problem:
    A city has budget to build K electric-vehicle charging stations. Out of many
    candidate sites (malls, petrol pumps, parking lots), choose K so that residents
    have to travel as little as possible to their nearest charger.

    The same idea is used for placing hospitals, ATMs, warehouses, fire stations
    and mobile towers (the "facility location" problem).

State:
    A set of K chosen candidate sites.

Cost (minimise):
    Population-weighted average distance from each residential area to its
    nearest chosen station (in km).

Neighbour:
    Swap one chosen site for one unused candidate site.

Algorithm:
    Steepest-ascent hill climbing (evaluate every swap, take the best) with
    random restarts. The result is compared against a random placement.
"""

import math
import random

AREA_NAMES = [
    "Green Park", "Model Town", "Civil Lines", "Sector 15", "Old City",
    "Lake View", "Tech Park", "University Area", "Railway Colony", "Hill Side",
    "Market Road", "Airport Road", "New Town", "River Side", "Industrial Area",
    "Garden Estate", "Station Road", "MG Road", "Cantonment", "Ring Road",
    "Sunrise Colony", "Palm Grove", "Shanti Nagar", "Nehru Place", "Gandhi Nagar",
]

SITE_TYPES = ["Mall", "Petrol Pump", "Metro Parking", "Hospital Lot", "Office Complex"]


def generate_city(seed=11, num_sites=30, size_km=20):
    rng = random.Random(seed)
    areas = []
    for name in AREA_NAMES:
        # More people live near the city centre
        x = min(max(rng.gauss(size_km / 2, size_km / 4), 0), size_km)
        y = min(max(rng.gauss(size_km / 2, size_km / 4), 0), size_km)
        population = rng.randint(5_000, 60_000)
        areas.append({"name": name, "x": x, "y": y, "pop": population})
    sites = []
    for i in range(num_sites):
        sites.append({"name": f"{rng.choice(SITE_TYPES)} #{i + 1}",
                      "x": rng.uniform(0, size_km), "y": rng.uniform(0, size_km)})
    return areas, sites


def dist(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def avg_distance(chosen, areas, sites):
    total_pop = sum(a["pop"] for a in areas)
    total = sum(a["pop"] * min(dist(a, sites[s]) for s in chosen) for a in areas)
    return total / total_pop


def hill_climb(k, areas, sites, rng):
    chosen = set(rng.sample(range(len(sites)), k))
    cost = avg_distance(chosen, areas, sites)
    start_cost = cost
    while True:
        best_swap, best_cost = None, cost
        unused = set(range(len(sites))) - chosen
        for out_site in chosen:
            for in_site in unused:
                candidate = (chosen - {out_site}) | {in_site}
                c = avg_distance(candidate, areas, sites)
                if c < best_cost:
                    best_swap, best_cost = candidate, c
        if best_swap is None:  # local optimum
            return chosen, cost, start_cost
        chosen, cost = best_swap, best_cost


def coverage_report(chosen, areas, sites, radius_km=3):
    total_pop = sum(a["pop"] for a in areas)
    covered = sum(a["pop"] for a in areas
                  if min(dist(a, sites[s]) for s in chosen) <= radius_km)
    return covered / total_pop * 100


def draw_map(chosen, areas, sites, size_km=20, width=50, height=20):
    grid = [[" "] * width for _ in range(height)]

    def put(item, ch):
        x = int(item["x"] / size_km * (width - 1))
        y = int(item["y"] / size_km * (height - 1))
        grid[height - 1 - y][x] = ch

    for a in areas:
        put(a, "o")
    for s in chosen:
        put(sites[s], "#")
    print("+" + "-" * width + "+")
    for row in grid:
        print("|" + "".join(row) + "|")
    print("+" + "-" * width + "+")
    print("  o = residential area    # = charging station")


def main():
    print("=" * 60)
    print("  EV CHARGING STATION PLACEMENT USING HILL CLIMBING")
    print("=" * 60)
    try:
        k = int(input("How many stations can the city afford? (2-10, default 5): ") or 5)
    except ValueError:
        k = 5
    k = max(2, min(k, 10))

    areas, sites = generate_city()
    print(f"\nCity: {len(areas)} residential areas, "
          f"{sum(a['pop'] for a in areas):,} people, {len(sites)} candidate sites\n")

    rng = random.Random(3)
    random_choice = set(rng.sample(range(len(sites)), k))
    random_cost = avg_distance(random_choice, areas, sites)

    best = None
    for r in range(5):
        chosen, cost, start = hill_climb(k, areas, sites, rng)
        print(f"  Restart {r + 1}: avg distance {start:5.2f} km -> {cost:5.2f} km")
        if best is None or cost < best[1]:
            best = (chosen, cost)
    chosen, cost = best

    print(f"\nRandom placement     : {random_cost:.2f} km average travel, "
          f"{coverage_report(random_choice, areas, sites):.0f}% people within 3 km")
    print(f"Hill climbing result : {cost:.2f} km average travel, "
          f"{coverage_report(chosen, areas, sites):.0f}% people within 3 km")
    print(f"Improvement          : {(1 - cost / random_cost) * 100:.1f}% less travel\n")

    print("Recommended sites:")
    for s in sorted(chosen):
        served = [a for a in areas
                  if min(chosen, key=lambda c: dist(a, sites[c])) == s]
        pop = sum(a["pop"] for a in served)
        print(f"  {sites[s]['name']:<22} serves {len(served):2} areas, {pop:>7,} people")
    print()
    draw_map(chosen, areas, sites)


if __name__ == "__main__":
    main()
