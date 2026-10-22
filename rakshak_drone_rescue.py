"""
Rakshak: Flood Rescue Drone Navigator (Greedy Best-First Search)

Real-life scenario:
    After heavy floods, people are stranded on rooftops across the city.
    A rescue drone leaves the relief base and must reach a survivor quickly.
    Tall buildings and storm zones block its way, so it has to find a route
    around them on a grid map of the city.

Map symbols:
    B  relief base (start)       1 2 3  stranded survivors (goals)
    #  tall building (blocked)   ~      storm / flood zone (blocked)
    .  open air (the drone can fly here)

Heuristic h(n):
    Manhattan distance from cell n to the survivor:  |row1 - row2| + |col1 - col2|
    (the drone flies North / South / East / West, one block at a time).

Greedy Best-First Search:
    Keep a priority queue (heapq) of cells to explore, ordered only by h(n).
    Always explore the cell that looks closest to the survivor next.
    It is very fast, but because it ignores the distance already flown it
    does not always find the shortest route. The program compares its route
    with the true shortest route (found by Breadth-First Search) to show this.

Run:
    python3 rakshak_drone_rescue.py
"""

import heapq
import random
from collections import deque

CITY_MAP = [
    "########################",
    "#B.....#.......~~~....1#",
    "#.###..#.###...~~~.###.#",
    "#.#....#...#...~~~...#.#",
    "#.#.####.#.#.......#.#.#",
    "#...#....#.#.####..#...#",
    "###.#.####.#....#..###.#",
    "#...#......####.#......#",
    "#.#####.##....#.####.#.#",
    "#.....#..#.##.#....#.#.#",
    "#.~~~.#..#..#.###..#...#",
    "#.~~~....#2.#.....##.#3#",
    "#.~~~.####..#.####...#.#",
    "########################",
]

BLOCKED = {"#", "~"}
MOVES = {"North": (-1, 0), "South": (1, 0), "West": (0, -1), "East": (0, 1)}


# ---------------------------------------------------------------- map helpers

def parse_map(rows):
    grid = [list(r) for r in rows]
    base, survivors = None, {}
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == "B":
                base = (r, c)
            elif ch.isdigit():
                survivors[ch] = (r, c)
    return grid, base, survivors


def neighbours(grid, cell):
    r, c = cell
    for direction, (dr, dc) in MOVES.items():
        nr, nc = r + dr, c + dc
        if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]) and grid[nr][nc] not in BLOCKED:
            yield direction, (nr, nc)


def heuristic(cell, goal):
    """Manhattan distance: how far the drone still is from the survivor."""
    return abs(cell[0] - goal[0]) + abs(cell[1] - goal[1])


def rebuild_path(came_from, goal):
    path, cell = [], goal
    while cell is not None:
        path.append(cell)
        cell = came_from[cell]
    return path[::-1]


# ---------------------------------------------------------------- search

def greedy_best_first_search(grid, start, goal, verbose=True):
    """Return (path, explored_cells). path is None if the survivor can't be reached."""
    counter = 0                                    # tie-breaker for equal h-scores
    frontier = [(heuristic(start, goal), counter, start)]
    came_from = {start: None}
    explored = []

    while frontier:
        h, _, cell = heapq.heappop(frontier)       # cell that looks closest to goal
        explored.append(cell)
        if verbose:
            print(f"  Step {len(explored):3}: exploring row {cell[0]:2}, col {cell[1]:2}"
                  f"   h = {h:2}   (queue size {len(frontier)})")
        if cell == goal:
            return rebuild_path(came_from, goal), explored

        for _, nxt in neighbours(grid, cell):
            if nxt not in came_from:
                came_from[nxt] = cell
                counter += 1
                heapq.heappush(frontier, (heuristic(nxt, goal), counter, nxt))

    return None, explored


def breadth_first_search(grid, start, goal):
    """True shortest route, used only for comparison."""
    queue = deque([start])
    came_from = {start: None}
    explored = 0
    while queue:
        cell = queue.popleft()
        explored += 1
        if cell == goal:
            return rebuild_path(came_from, goal), explored
        for _, nxt in neighbours(grid, cell):
            if nxt not in came_from:
                came_from[nxt] = cell
                queue.append(nxt)
    return None, explored


# ---------------------------------------------------------------- output

def flight_instructions(path):
    """Turn the cell path into 'Fly East 5 blocks -> Fly South 2 blocks ...'."""
    steps = []
    for a, b in zip(path, path[1:]):
        d = next(name for name, (dr, dc) in MOVES.items() if (a[0] + dr, a[1] + dc) == b)
        if steps and steps[-1][0] == d:
            steps[-1][1] += 1
        else:
            steps.append([d, 1])
    return " -> ".join(f"Fly {d} {n} block{'s' if n > 1 else ''}" for d, n in steps)


def print_map(grid, path=None, explored=None):
    path_set = set(path or [])
    explored_set = set(explored or [])
    for r, row in enumerate(grid):
        line = ""
        for c, ch in enumerate(row):
            cell = (r, c)
            if ch in "B123" or ch in BLOCKED:
                line += ch
            elif cell in path_set:
                line += "*"
            elif cell in explored_set:
                line += "o"
            else:
                line += " " if ch == "." else ch
        print("   " + " ".join(line))
    if path:
        print("   * drone route   o explored but not used   # building   ~ storm zone")


def random_city(rows=14, cols=24, density=0.28):
    """Make a random city with a base and 3 survivors that can all be reached."""
    while True:
        grid = [["#"] * cols for _ in range(rows)]
        for r in range(1, rows - 1):
            for c in range(1, cols - 1):
                roll = random.random()
                grid[r][c] = "#" if roll < density else ("~" if roll < density + 0.05 else ".")
        open_cells = [(r, c) for r in range(rows) for c in range(cols) if grid[r][c] == "."]
        picks = random.sample(open_cells, 4)
        (br, bc), others = picks[0], picks[1:]
        grid[br][bc] = "B"
        for n, (r, c) in enumerate(others, 1):
            grid[r][c] = str(n)
        if all(breadth_first_search(grid, (br, bc), g)[0] for g in others):
            return ["".join(row) for row in grid]


# ---------------------------------------------------------------- CLI

def rescue(rows):
    grid, base, survivors = parse_map(rows)
    print()
    print_map(grid)
    choice = input(f"\nWhich survivor should the drone rescue? ({'/'.join(sorted(survivors))}): ").strip()
    if choice not in survivors:
        print("  Invalid survivor number.")
        return
    goal = survivors[choice]

    print(f"\nDrone launching from base {base} to survivor {choice} at {goal}")
    print(f"Straight-line (Manhattan) distance: {heuristic(base, goal)} blocks\n")
    path, explored = greedy_best_first_search(grid, base, goal)

    if path is None:
        print("\n  No safe route exists. Survivor cannot be reached by drone.")
        return

    shortest, bfs_explored = breadth_first_search(grid, base, goal)
    print("\n" + "=" * 62)
    print(f"  SURVIVOR {choice} REACHED")
    print("=" * 62)
    print_map(grid, path, explored)
    print(f"\n  Route: Start at base -> {flight_instructions(path)} -> Survivor {choice}")
    print(f"\n  Blocks flown            : {len(path) - 1}")
    print(f"  Cells explored (Greedy) : {len(explored)}")
    print("\n  Comparison with Breadth-First Search (guaranteed shortest):")
    print(f"    Shortest route        : {len(shortest) - 1} blocks, explored {bfs_explored} cells")
    extra = (len(path) - 1) - (len(shortest) - 1)
    if extra == 0:
        print("    Greedy found the shortest route while exploring "
              f"{bfs_explored - len(explored)} fewer cells.")
    else:
        print(f"    Greedy route is {extra} blocks longer, but it explored "
              f"{bfs_explored - len(explored)} fewer cells (faster decision).")
    print("=" * 62)


def main():
    current_map = CITY_MAP
    while True:
        print("\n" + "=" * 44)
        print("   RAKSHAK: FLOOD RESCUE DRONE NAVIGATOR")
        print("        (Greedy Best-First Search)")
        print("=" * 44)
        print("1. Send drone to a survivor")
        print("2. Generate a new random flood map")
        print("3. Restore the default city map")
        print("4. Exit")
        choice = input("Choose an option (1-4): ").strip()
        if choice == "1":
            rescue(current_map)
        elif choice == "2":
            current_map = random_city()
            print("\n  New flood map generated:\n")
            print_map(parse_map(current_map)[0])
        elif choice == "3":
            current_map = CITY_MAP
            print("  Default city map restored.")
        elif choice == "4":
            print("Rakshak signing off. Stay safe!")
            break
        else:
            print("Invalid choice, please enter 1-4.")


if __name__ == "__main__":
    main()
