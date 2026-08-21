"""The @testcase decorator that ties a python test to a Test Case ID.

    @testcase("TC-PO-F02", "Account Login",
              "Authenticates and lands on the pet owner home page",
              category="functional", role="owner")
    def test_owner_login(...):
        ...

It applies three things at once: the metadata the report is built from, the
category marker (functional/performance/security/usability) and the role
marker, so `-m "security and admin"` selects exactly what you would expect.
"""

from __future__ import annotations

import pytest

CATEGORIES = ("functional", "performance", "security", "usability")
ROLES = ("owner", "vet", "admin", "system")


def testcase(tc_id: str, feature: str, expected: str, category: str, role: str):
    if category not in CATEGORIES:
        raise ValueError(f"Unknown category {category!r}")
    if role not in ROLES:
        raise ValueError(f"Unknown role {role!r}")

    def decorate(func):
        func = pytest.mark.testcase(
            tc_id=tc_id, feature=feature, expected=expected,
            category=category, role=role,
        )(func)
        func = getattr(pytest.mark, category)(func)
        func = getattr(pytest.mark, role)(func)
        return func

    return decorate
