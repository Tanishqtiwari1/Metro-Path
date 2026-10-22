"""
CloudBalancer: Server Load Optimizer (Hill Climbing)

Real-life scenario:
    A tech company has 3 cloud servers and 20 computing tasks, each needing a
    different amount of CPU. A random assignment can overload one server while
    another sits idle. Hill climbing moves tasks around until the CPU load is
    as even as possible.

State:
    servers = [[tasks on Server 1], [tasks on Server 2], [tasks on Server 3]]

Score (minimise):
    max server load - min server load   (0 = perfectly balanced)

Neighbour:
    Take a random task from the heaviest server and move it to the lightest.
    Keep the move if the score drops, otherwise undo it.
    Stop when no single task from the heaviest server can be moved to the
    lightest server without making the balance worse.

Run:
    python3 cloudbalancer.py            (random tasks)
    python3 cloudbalancer.py --seed 5   (repeatable run)
"""

import argparse
import random

NUM_TASKS = 20
NUM_SERVERS = 3
SERVER_NAMES = ["Server 1", "Server 2", "Server 3"]


# ---------------------------------------------------------------- data

def create_tasks(rng):
    """20 tasks named Task A, Task B, ... with random CPU weights 10-100."""
    tasks = []
    for i in range(NUM_TASKS):
        tasks.append({"name": "Task " + chr(ord("A") + i), "cpu": rng.randint(10, 100)})
    return tasks


def random_assignment(tasks, rng):
    """Start state: each task goes to a random server."""
    servers = [[] for _ in range(NUM_SERVERS)]
    for task in tasks:
        servers[rng.randrange(NUM_SERVERS)].append(task)
    return servers


# ---------------------------------------------------------------- objective

def server_loads(servers):
    """Total CPU weight on each server."""
    return [sum(task["cpu"] for task in server) for server in servers]


def score(servers):
    """Difference between the heaviest and the lightest server."""
    loads = server_loads(servers)
    return max(loads) - min(loads)


# ---------------------------------------------------------------- algorithm

def hill_climb(servers, rng):
    """Balance the servers in place. Returns the list of kept moves."""
    current_score = score(servers)
    moves = []

    while True:
        loads = server_loads(servers)
        heaviest = loads.index(max(loads))
        lightest = loads.index(min(loads))

        # Try the heaviest server's tasks in random order
        candidates = servers[heaviest][:]
        rng.shuffle(candidates)

        improved = False
        for task in candidates:
            servers[heaviest].remove(task)           # make the move
            servers[lightest].append(task)
            new_score = score(servers)

            if new_score < current_score:            # better balance: keep it
                moves.append((task, heaviest, lightest, current_score, new_score))
                current_score = new_score
                improved = True
                break

            servers[lightest].remove(task)           # worse: undo the move
            servers[heaviest].append(task)

        if not improved:                             # no single move helps
            return moves


# ---------------------------------------------------------------- output

def print_servers(servers):
    loads = server_loads(servers)
    biggest = max(loads) or 1
    for name, server, load in zip(SERVER_NAMES, servers, loads):
        bar = "#" * round(load / biggest * 40)
        print(f"  {name}: {load:4} CPU |{bar}")
        task_text = ", ".join(f"{t['name']}({t['cpu']})" for t in server) or "(idle)"
        print(f"            {len(server)} tasks: {task_text}")


def main():
    parser = argparse.ArgumentParser(description="CloudBalancer: Server Load Optimizer")
    parser.add_argument("--seed", type=int, help="seed for a repeatable run")
    args = parser.parse_args()
    rng = random.Random(args.seed)

    tasks = create_tasks(rng)
    servers = random_assignment(tasks, rng)
    total = sum(t["cpu"] for t in tasks)
    ideal = total / NUM_SERVERS

    print("=" * 66)
    print("  CLOUDBALANCER: SERVER LOAD OPTIMIZER  (Hill Climbing)")
    print("=" * 66)
    print(f"  {NUM_TASKS} tasks, {NUM_SERVERS} servers, total demand {total} CPU")
    print(f"  Perfect balance would be {ideal:.1f} CPU per server\n")

    print("INITIAL RANDOM STATE")
    print_servers(servers)
    initial_score = score(servers)
    print(f"\n  Load difference (max - min): {initial_score} CPU\n")

    print("HILL CLIMBING")
    moves = hill_climb(servers, rng)
    for n, (task, src, dst, before, after) in enumerate(moves, 1):
        print(f"  Move {n:2}: {task['name']} ({task['cpu']} CPU) "
              f"{SERVER_NAMES[src]} -> {SERVER_NAMES[dst]}   score {before} -> {after}")
    if not moves:
        print("  The random start was already as balanced as single moves allow.")
    print("  Stopped: moving any task from the heaviest to the lightest server"
          " would make the balance worse.\n")

    print("FINAL OPTIMIZED STATE")
    print_servers(servers)
    final_score = score(servers)
    loads = server_loads(servers)
    print(f"\n  Load difference (max - min): {initial_score} CPU -> {final_score} CPU")
    for name, load in zip(SERVER_NAMES, loads):
        print(f"    {name}: {load} CPU ({load - ideal:+.1f} from the ideal {ideal:.1f})")
    balance = (1 - final_score / ideal) * 100
    print(f"  Balance achieved: {balance:.1f}% "
          f"(100% = all servers exactly equal)")


if __name__ == "__main__":
    main()
