"""Utility for computing hash-based subdirectory paths for file distribution.

Files are distributed across a two-level directory tree derived from the MD5
hash of their name (without extension). 
The resulting path uses the pattern: ``{h[0]}{h[1]}/{h[2]}{h[3]}`` where ``h`` 
is the hex digest, giving up to 256 x 256 = 65 536 leaf directories, enough to 
keep directory listings small even with millions of files.
"""

import hashlib

# MD5 is intentionally used here for fast, uniform distribution of files
# across directory buckets.  This is NOT a security-sensitive context –
# collision resistance is irrelevant for directory sharding purposes.


def get_hash_subdir(name: str) -> str:
    """Return a two-level subdirectory path derived from the MD5 hash of *name*.
    get_hash_subdir("P38398_1jm7.1.A_1_103")  # doctest: +SKIP
    'ec/59'
    Args:
        name: Identifier to hash (typically the model filename without extension).
    Returns:
        A relative path of the form ``{ch1}{ch2}/{ch3}{ch4}`` where each
        ``chX`` is the Xth hexadecimal character of the MD5 digest of *name*.
    """
    h = hashlib.md5(name.encode()).hexdigest()
    return f"{h[0]}{h[1]}/{h[2]}{h[3]}"
