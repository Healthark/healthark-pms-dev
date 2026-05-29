"""
Pure-function tests for app.core.security.

Password hashing (passlib bcrypt) is self-contained and doesn't need a DB.
JWT signing uses settings.SECRET_KEY, which is loaded from env — CI provides
a dummy SECRET_KEY so these tests run without a real .env.
"""

from datetime import timedelta

import jwt

from app.core.config import settings
from app.core.security import (
    ALGORITHM,
    create_access_token,
    get_password_hash,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_then_verify_roundtrips(self):
        hashed = get_password_hash("password123")
        assert verify_password("password123", hashed) is True

    def test_wrong_password_does_not_verify(self):
        hashed = get_password_hash("password123")
        assert verify_password("wrong", hashed) is False

    def test_each_hash_is_unique_thanks_to_salt(self):
        # bcrypt generates a fresh salt per hash; same input → different output.
        h1 = get_password_hash("password123")
        h2 = get_password_hash("password123")
        assert h1 != h2
        # ...but both still verify against the original plaintext.
        assert verify_password("password123", h1) is True
        assert verify_password("password123", h2) is True


class TestAccessToken:
    def test_token_decodes_with_original_payload(self):
        token = create_access_token({"sub": "42", "role": "Admin"})
        decoded = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        assert decoded["sub"] == "42"
        assert decoded["role"] == "Admin"
        assert "exp" in decoded  # expiry stamp added by create_access_token

    def test_token_signed_with_wrong_key_fails(self):
        token = create_access_token({"sub": "42"})
        try:
            jwt.decode(token, "wrong-secret", algorithms=[ALGORITHM])
        except jwt.InvalidSignatureError:
            return
        raise AssertionError("expected InvalidSignatureError")

    def test_custom_expiry_is_honored(self):
        import time
        token = create_access_token({"sub": "1"}, expires_delta=timedelta(seconds=-1))
        # Already-expired token should refuse to decode.
        try:
            jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        except jwt.ExpiredSignatureError:
            return
        raise AssertionError("expected ExpiredSignatureError")
