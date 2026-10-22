"""
Metro Path Search: Greedy Best-First Search on a city metro map

Real-life scenario:
    A commuter wants the sequence of stations from a start station to a
    destination on a small city metro network.

Graph:
    METRO_MAP is a dictionary: station -> list of directly connected stations.

Heuristic h(n):
    Straight-line (Euclidean) distance from station n to the destination,
    using each station's (x, y) map coordinates in km.

Greedy Best-First Search:
    Keep a priority queue of stations to evaluate, ordered by h(n) only.
    Always expand the station that is physically closest to the destination.
    (Unlike A*, it ignores the distance already travelled, so it is fast
    but does not always give the shortest route.)
"""

import heapq
import math

# Station coordinates on the city map (in km)
STATIONS = {
    "Central Station": (5, 5),
    "Downtown":        (4, 4),
    "City Hall":       (6, 4),
    "North Park":      (5, 8),
    "University":      (3, 9),
    "Museum":          (7, 7),
    "Airport":         (9, 10),
    "Riverside":       (2, 5),
    "Old Town":        (1, 3),
    "Market Square":   (5, 2),
    "Stadium":         (8, 3),
    "Harbour":         (10, 1),
    "Tech Park":       (9, 6),
    "Lakeside":        (2, 1),
}

# Metro lines: which stations are directly connected
METRO_MAP = {
    "Central Station": ["Downtown", "City Hall", "North Park", "Riverside", "Museum"],
    "Downtown":        ["Central Station", "Market Square", "Old Town", "Riverside"],
    "City Hall":       ["Central Station", "Market Square", "Stadium", "Tech Park"],
    "North Park":      ["Central Station", "University", "Museum"],
    "University":      ["North Park", "Riverside"],
    "Museum":          ["Central Station", "North Park", "Airport", "Tech Park"],
    "Airport":         ["Museum", "Tech Park"],
    "Riverside":       ["Central Station", "Downtown", "University", "Old Town"],
    "Old Town":        ["Riverside", "Downtown", "Lakeside"],
    "Market Square":   ["Downtown", "City Hall", "Lakeside", "Stadium"],
    "Stadium":         ["City Hall", "Market Square", "Harbour", "Tech Park"],
    "Harbour":         ["Stadium"],
    "Tech Park":       ["City Hall", "Museum", "Airport", "Stadium"],
    "Lakeside":        ["Old Town", "Market Square"],
}


def heuristic(station, goal):
    """Straight-line distance between two stations (h-score)."""
    (x1, y1), (x2, y2) = STATIONS[station], STATIONS[goal]
    return math.hypot(x2 - x1, y2 - y1)


def greedy_best_first_search(start, goal, verbose=True):
    """
    Return (path, explored_order) or (None, explored_order) if unreachable.

    The priority queue holds (h_score, station). heapq always pops the
    station with the smallest h_score, i.e. the one closest to the goal.
    """
    frontier = [(heuristic(start, goal), start)]
    came_from = {start: None}
    explored = []

    while frontier:
        h, current = heapq.heappop(frontier)
        explored.append(current)
        if verbose:
            print(f"  Evaluating {current:<16} h = {h:5.2f} km")

        if current == goal:
            path = []
            while current is not None:
                path.append(current)
                current = came_from[current]
            return path[::-1], explored

        for neighbor in METRO_MAP[current]:
            if neighbor not in came_from:          # not yet discovered
                came_from[neighbor] = current
                h_n = heuristic(neighbor, goal)
                heapq.heappush(frontier, (h_n, neighbor))
                if verbose:
                    print(f"      -> neighbour {neighbor:<16} h = {h_n:5.2f} km (added to queue)")

    return None, explored


def route_distance(path):
    return sum(heuristic(a, b) for a, b in zip(path, path[1:]))


def format_route(path):
    if len(path) == 1:
        return f"You are already at {path[0]}."
    steps = [f"Start at {path[0]}"]
    steps += [f"Go to {s}" for s in path[1:-1]]
    steps.append(f"Arrive at {path[-1]}")
    return " -> ".join(steps)


# ---------------- Command-line interface ----------------

STATION_LIST = sorted(STATIONS)


def show_stations():
    print("\nMetro stations:")
    for i, name in enumerate(STATION_LIST, 1):
        x, y = STATIONS[name]
        print(f"  {i:2}. {name:<16} ({x}, {y})  lines to: {', '.join(METRO_MAP[name])}")


def ask_station(prompt):
    """Accept a station number, a full name or a unique prefix (case-insensitive)."""
    while True:
        text = input(prompt).strip()
        if text.isdigit() and 1 <= int(text) <= len(STATION_LIST):
            return STATION_LIST[int(text) - 1]
        matches = [s for s in STATION_LIST if s.lower() == text.lower()]
        if not matches:
            matches = [s for s in STATION_LIST if s.lower().startswith(text.lower())] if text else []
        if len(matches) == 1:
            return matches[0]
        if matches:
            print(f"  Ambiguous - did you mean: {', '.join(matches)}?")
        else:
            print("  Station not found. Type its number or name (option 2 lists them).")


def find_route():
    show_stations()
    start = ask_station("\nEnter START station (name or number): ")
    goal = ask_station("Enter DESTINATION station (name or number): ")

    print(f"\nSearching from {start} to {goal} using Greedy Best-First Search...\n")
    path, explored = greedy_best_first_search(start, goal)

    print("\n" + "=" * 60)
    if path is None:
        print(f"No route exists between {start} and {goal}.")
        return
    print("ROUTE FOUND")
    print("=" * 60)
    print(format_route(path))
    print(f"\nTotal stops        : {len(path) - 1}")
    print(f"Track distance     : {route_distance(path):.2f} km")
    print(f"Stations evaluated : {len(explored)}")
    print("=" * 60)


def main():
    while True:
        print("\n" + "=" * 40)
        print("        METRO PATH SEARCH")
        print("   (Greedy Best-First Search)")
        print("=" * 40)
        print("1. Find a route")
        print("2. List all stations")
        print("3. Exit")
        choice = input("Choose an option (1-3): ").strip()
        if choice == "1":
            find_route()
        elif choice == "2":
            show_stations()
        elif choice == "3":
            print("Thank you for using Metro Path Search. Goodbye!")
            break
        else:
            print("Invalid choice, please enter 1, 2 or 3.")


if __name__ == "__main__":
    main()
