#!/usr/bin/env python3
"""
Add the attendance platform to Intimaa's docker-compose.override.yml without
removing anything other platforms (Dafter, PILL, ...) put there.

How: whatever file is currently mounted as Caddy's main config
(/etc/caddy/Caddyfile) is re-mounted as /etc/caddy/attendance-prev.Caddyfile,
and our generated Caddyfile (which imports it, then adds our site) becomes the
main config. Every other line of the override is kept as is.

Usage: merge_override.py <override.yml> <our Caddyfile path> <domain>
Prints a short summary. Line-based on purpose (no PyYAML on a stock server).
Idempotent: running it again only updates the domain.
"""
import re
import sys

MARK = "# Extended by attendance-platform's deploy/install.sh (Caddy also serves the attendance platform)."
TARGET = "/etc/caddy/Caddyfile"
PREV = "/etc/caddy/attendance-prev.Caddyfile"


def indent(line):
    return len(line) - len(line.lstrip(" "))


def find_block(lines, start, key, parent_indent):
    """Index of `key:` directly inside the block starting after `start`, or None."""
    child = None
    for i in range(start + 1, len(lines)):
        l = lines[i]
        if not l.strip() or l.lstrip().startswith("#"):
            continue
        ind = indent(l)
        if ind <= parent_indent:
            return None
        if child is None:
            child = ind
        if ind == child and re.match(rf"\s*{re.escape(key)}\s*:", l):
            return i
    return None


def block_end(lines, start):
    """Index after the last line belonging to the block that starts at `start`."""
    base = indent(lines[start])
    i = start + 1
    while i < len(lines):
        l = lines[i]
        if l.strip() and not l.lstrip().startswith("#") and indent(l) <= base:
            break
        i += 1
    while i > start + 1 and not lines[i - 1].strip():
        i -= 1
    return i


def main():
    path, site, domain = sys.argv[1:4]
    try:
        text = open(path).read()
    except FileNotFoundError:
        text = ""
    lines = text.splitlines()

    if not lines:
        lines = ["services:", "  caddy:"]
    if not any(re.match(r"services\s*:", l) for l in lines):
        sys.exit("override has no 'services:' section")
    svc = next(i for i, l in enumerate(lines) if re.match(r"services\s*:", l))
    caddy = find_block(lines, svc, "caddy", 0)
    if caddy is None:
        lines[svc + 1:svc + 1] = ["  caddy:"]
        caddy = svc + 1
    cind = indent(lines[caddy])
    kind = cind + 2

    # ---- volumes: re-point the main Caddyfile mount, add ours ----
    vol = find_block(lines, caddy, "volumes", cind)
    if vol is None:
        end = block_end(lines, caddy)
        lines[end:end] = [" " * kind + "volumes:"]
        vol = end
    vend = block_end(lines, vol)
    items = list(range(vol + 1, vend))
    ours = f"{site}:{TARGET}:ro"
    has_prev = any(PREV in lines[i] for i in items)
    main_idx = [i for i in items if re.search(rf":{re.escape(TARGET)}(:ro)?\s*$", lines[i].strip().strip("'\""))]
    item_ind = indent(lines[items[0]]) if items else kind + 2
    if main_idx:
        i = main_idx[0]
        src = lines[i].strip().lstrip("-").strip().strip("'\"").split(":")[0]
        if src != site:  # someone else's file is the main config: keep it as "previous"
            if has_prev:
                sys.exit("override already chains a previous Caddyfile and another file is now the main one; merge by hand")
            lines[i] = " " * item_ind + f"- {src}:{PREV}:ro"
            lines.insert(vend, " " * item_ind + f"- {ours}")
            prev_src = src
        else:
            prev_src = "(already set up)"
    else:
        # nothing overrides it: the main config is Intimaa's own ./Caddyfile
        add = [] if has_prev else [" " * item_ind + f"- ./Caddyfile:{PREV}:ro"]
        lines[vend:vend] = add + [" " * item_ind + f"- {ours}"]
        prev_src = "./Caddyfile (Intimaa)"

    # ---- environment: ATTENDANCE_DOMAIN ----
    env = find_block(lines, caddy, "environment", cind)
    if env is None:
        end = block_end(lines, caddy)
        lines[end:end] = [" " * kind + "environment:", " " * (kind + 2) + f"ATTENDANCE_DOMAIN: {domain}"]
    else:
        eend = block_end(lines, env)
        eitems = [i for i in range(env + 1, eend) if lines[i].strip() and not lines[i].lstrip().startswith("#")]
        list_form = bool(eitems) and lines[eitems[0]].lstrip().startswith("-")
        eind = indent(lines[eitems[0]]) if eitems else kind + 2
        new = " " * eind + (f"- ATTENDANCE_DOMAIN={domain}" if list_form else f"ATTENDANCE_DOMAIN: {domain}")
        found = [i for i in eitems if "ATTENDANCE_DOMAIN" in lines[i]]
        if found:
            lines[found[0]] = new
        else:
            lines.insert(eend, new)

    # ---- networks: caddy must reach attendance-app on "edge" ----
    net = find_block(lines, caddy, "networks", cind)
    if net is None:
        end = block_end(lines, caddy)
        lines[end:end] = [" " * kind + "networks: [default, edge]"]
    else:
        nend = block_end(lines, net)
        chunk = "\n".join(lines[net:nend])
        if "edge" not in chunk:
            if "[" in lines[net]:
                lines[net] = lines[net].replace("]", ", edge]", 1)
            else:
                ni = indent(lines[net + 1]) if nend > net + 1 else kind + 2
                lines.insert(nend, " " * ni + "- edge")
    if not any(re.match(r"networks\s*:", l) for l in lines):
        lines += ["", "networks:", "  edge:", "    external: true", "    name: edge"]
    else:
        top = next(i for i, l in enumerate(lines) if re.match(r"networks\s*:", l))
        if find_block(lines, top, "edge", 0) is None:
            end = block_end(lines, top)
            lines[end:end] = ["  edge:", "    external: true", "    name: edge"]

    if MARK not in lines:
        lines.insert(0, MARK)
    open(path, "w").write("\n".join(lines) + "\n")
    print(f"previous main Caddyfile: {prev_src}")


if __name__ == "__main__":
    main()
