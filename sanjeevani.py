"""
Sanjeevani: Emergency Standby Positioner (Hill Climbing)

Real-life scenario:
    During peak hours an ambulance waiting at the main hospital takes too long
    to reach emergencies. The municipal corporation wants to park a standby
    ambulance at the best street intersection, using 50 recent emergency
    locations, so that the average distance to an emergency is as small as possible.

City grid:
    100 x 100 intersections. 1 grid unit = one city block = 0.1 km.

State:
    The (X, Y) intersection where the ambulance is parked.

Score (minimise):
    Average Response Distance = average straight-line distance from the
    ambulance to all 50 emergency hotspots.

Steepest-descent hill climbing:
    1. Park the ambulance at a random intersection.
    2. Look at the 4 neighbours: 1 block North, South, East and West.
    3. Move to the neighbour with the lowest average distance, if it is
       better than staying.
    4. Stop when no direction gives a shorter average distance.

Run:
    python3 sanjeevani.py            (random city)
    python3 sanjeevani.py --seed 3   (repeatable run)
"""

import argparse
import math
import random
import time

GRID_SIZE = 100          # intersections 0..100 on each axis
NUM_HOTSPOTS = 50
KM_PER_UNIT = 0.1        # one block = 100 m
HOSPITAL = (5, 5)        # main hospital in the south-west corner

DIRECTIONS = {
    "North": (0, 1),
    "South": (0, -1),
    "East":  (1, 0),
    "West":  (-1, 0),
}


# ---------------------------------------------------------------- data

def generate_hotspots(rng):
    """50 recent emergency locations at random (X, Y) points on the grid."""
    return [(rng.randint(0, GRID_SIZE), rng.randint(0, GRID_SIZE))
            for _ in range(NUM_HOTSPOTS)]


# ---------------------------------------------------------------- objective

def average_response_distance(position, hotspots):
    """Average distance (in km) from the ambulance to every hotspot."""
    x, y = position
    total = sum(math.hypot(hx - x, hy - y) for hx, hy in hotspots)
    return total / len(hotspots) * KM_PER_UNIT


# ---------------------------------------------------------------- algorithm

def neighbours(position):
    """The 4 intersections one block away (staying inside the city)."""
    x, y = position
    for direction, (dx, dy) in DIRECTIONS.items():
        nx, ny = x + dx, y + dy
        if 0 <= nx <= GRID_SIZE and 0 <= ny <= GRID_SIZE:
            yield direction, (nx, ny)


def hill_climb(start, hotspots, log=None):
    """Steepest descent from `start`. Returns (best_position, best_score, path)."""
    current = start
    current_score = average_response_distance(current, hotspots)
    path = [current]

    while True:
        best_direction, best_position, best_score = None, None, current_score
        for direction, position in neighbours(current):
            s = average_response_distance(position, hotspots)
            if s < best_score:                 # keep the biggest improvement
                best_direction, best_position, best_score = direction, position, s

        if best_position is None:              # every direction is worse
            return current, current_score, path

        current, current_score = best_position, best_score
        path.append(current)
        if log:
            log(len(path) - 1, best_direction, current, current_score)


# ---------------------------------------------------------------- output

def draw_map(hotspots, path, width=50, height=25):
    """Text map: * hotspot, H hospital, S start, . route driven, A final spot."""
    grid = [[" "] * width for _ in range(height)]

    def put(point, ch):
        col = round(point[0] / GRID_SIZE * (width - 1))
        row = round(point[1] / GRID_SIZE * (height - 1))
        grid[height - 1 - row][col] = ch

    for h in hotspots:
        put(h, "*")
    for p in path[1:-1]:
        put(p, ".")
    put(HOSPITAL, "H")
    put(path[0], "S")
    put(path[-1], "A")

    print("                          N")
    print("  +" + "-" * width + "+")
    for row in grid:
        print("  |" + "".join(row) + "|")
    print("  +" + "-" * width + "+")
    print("                          S")
    print("  * emergency hotspot   H main hospital   S start   . route   A standby spot")


def main():
    parser = argparse.ArgumentParser(description="Sanjeevani: Emergency Standby Positioner")
    parser.add_argument("--seed", type=int, help="seed for a repeatable run")
    parser.add_argument("--no-delay", action="store_true", help="print the log without the driving delay")
    args = parser.parse_args()
    rng = random.Random(args.seed)

    hotspots = generate_hotspots(rng)
    start = (rng.randint(0, GRID_SIZE), rng.randint(0, GRID_SIZE))
    start_score = average_response_distance(start, hotspots)

    print("=" * 64)
    print("  SANJEEVANI: EMERGENCY STANDBY POSITIONER  (Hill Climbing)")
    print("=" * 64)
    print(f"  City grid: {GRID_SIZE} x {GRID_SIZE} blocks (1 block = {KM_PER_UNIT * 1000:.0f} m)")
    print(f"  Emergency hotspots loaded: {len(hotspots)}\n")

    print(f"Initial random parking spot : {start}")
    print(f"Average response distance   : {start_score:.2f} km\n")
    print("Driving towards the best spot...")

    def log(step, direction, position, score):
        print(f"  Step {step:3}: Moving {direction:<5} to ({position[0]:3}, {position[1]:3})"
              f" -> Avg Distance: {score:.3f} km")
        if not args.no_delay:
            time.sleep(0.03)

    best, best_score, path = hill_climb(start, hotspots, log)
    if len(path) == 1:
        print("  The random spot is already the best intersection nearby.")

    hospital_score = average_response_distance(HOSPITAL, hotspots)
    saved = start_score - best_score

    print("\nStopped: moving North, South, East or West would increase the distance.")
    print("=" * 64)
    print(f"  OPTIMAL STANDBY PARKING SPOT : {best}")
    print(f"  Average response distance    : {best_score:.2f} km")
    print(f"  Blocks driven to get there   : {len(path) - 1}")
    print(f"  Better than random start by  : {saved:.2f} km ({saved / start_score * 100:.1f}%)")
    print(f"  Better than main hospital {HOSPITAL} ({hospital_score:.2f} km) by "
          f"{hospital_score - best_score:.2f} km "
          f"({(hospital_score - best_score) / hospital_score * 100:.1f}%)")
    print("=" * 64 + "\n")
    draw_map(hotspots, path)


if __name__ == "__main__":
    main()
