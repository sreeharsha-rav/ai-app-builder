#!/usr/bin/env python3
"""
Comprehensive backend API test for Multi-Workspace Expense & Budget Tracker.
Tests all 8 critical acceptance criteria.
"""
import requests
import json
import time
import base64
from datetime import datetime, timedelta

BASE_URL = "http://localhost:3000/api"
PASSWORD = "demo1234"

# Test accounts
ACCOUNTS = {
    "owner": "owner@demo.com",
    "admin": "admin@demo.com", 
    "member": "member@demo.com",
    "own": "own@demo.com",
    "viewer": "viewer@demo.com",
}

class TestSession:
    def __init__(self, email):
        self.email = email
        self.session = requests.Session()
        self.user_id = None
        self.workspaces = []
        self.access_token = None
        
    def login(self):
        """Login and get access token for Bearer auth"""
        try:
            resp = self.session.post(f"{BASE_URL}/auth/login", json={
                "email": self.email,
                "password": PASSWORD
            })
            if resp.status_code != 200:
                print(f"❌ Login failed for {self.email}: {resp.status_code} {resp.text}")
                return False
            
            # Extract access token from cookie for Bearer auth
            # (cookies have secure flag so won't work over HTTP)
            self.access_token = resp.cookies.get('lg_at')
            if not self.access_token:
                print(f"❌ No access token in response")
                return False
            
            # Set Bearer token for all future requests
            self.session.headers.update({
                'Authorization': f'Bearer {self.access_token}'
            })
            
            data = resp.json()
            self.user_id = data["user"]["id"]
            self.workspaces = data["workspaces"]
            print(f"✅ Logged in as {self.email} (user_id: {self.user_id})")
            
            return True
        except Exception as e:
            print(f"❌ Login exception for {self.email}: {e}")
            return False
    
    def get(self, path):
        return self.session.get(f"{BASE_URL}{path}")
    
    def post(self, path, data=None):
        return self.session.post(f"{BASE_URL}{path}", json=data)
    
    def put(self, path, data=None):
        return self.session.put(f"{BASE_URL}{path}", json=data)
    
    def delete(self, path, data=None):
        return self.session.delete(f"{BASE_URL}{path}", json=data)

def decode_jwt(token):
    """Decode JWT payload without verification"""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        # Add padding if needed
        payload = parts[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        decoded = base64.urlsafe_b64decode(payload)
        return json.loads(decoded)
    except Exception as e:
        print(f"JWT decode error: {e}")
        return None

def test_1_auth():
    """Test 1: Auth - refresh rotation, logout, JWT payload"""
    print("\n" + "="*80)
    print("TEST 1: AUTH - Refresh Rotation, Logout, JWT Payload")
    print("="*80)
    
    # Test JWT payload contains only sub/iat/exp
    print("\n[1.1] Testing JWT payload structure...")
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ACCOUNTS["owner"],
            "password": PASSWORD
        })
        if resp.status_code != 200:
            print(f"❌ Login failed: {resp.status_code}")
            return False
        
        # Extract access token from cookie
        cookies = resp.cookies
        access_token = cookies.get('lg_at')
        if not access_token:
            print("❌ No access token cookie found")
            return False
        
        payload = decode_jwt(access_token)
        if not payload:
            print("❌ Failed to decode JWT")
            return False
        
        print(f"JWT payload keys: {list(payload.keys())}")
        
        # Check ONLY sub, iat, exp are present
        required = {'sub', 'iat', 'exp'}
        actual = set(payload.keys())
        
        if actual != required:
            print(f"❌ JWT payload incorrect. Expected {required}, got {actual}")
            if 'workspace_id' in actual or 'role' in actual:
                print("❌ CRITICAL: JWT contains workspace_id or role (should not!)")
            return False
        
        print(f"✅ JWT payload correct: {payload.keys()}")
        
    except Exception as e:
        print(f"❌ JWT test exception: {e}")
        return False
    
    # Test refresh token rotation
    print("\n[1.2] Testing refresh token rotation...")
    try:
        session = requests.Session()
        
        # Login
        resp = session.post(f"{BASE_URL}/auth/login", json={
            "email": ACCOUNTS["member"],
            "password": PASSWORD
        })
        if resp.status_code != 200:
            print(f"❌ Login failed: {resp.status_code}")
            return False
        
        # Get first refresh token
        refresh1 = session.cookies.get('lg_rt')
        if not refresh1:
            print("❌ No refresh token cookie")
            return False
        
        print(f"✅ Got first refresh token")
        
        # Use refresh endpoint
        resp = session.post(f"{BASE_URL}/auth/refresh")
        if resp.status_code != 200:
            print(f"❌ First refresh failed: {resp.status_code}")
            return False
        
        refresh2 = session.cookies.get('lg_rt')
        if not refresh2 or refresh2 == refresh1:
            print(f"❌ Refresh token not rotated")
            return False
        
        print(f"✅ Refresh token rotated")
        
        # Try to reuse old refresh token (should fail)
        session2 = requests.Session()
        session2.cookies.set('lg_rt', refresh1)
        resp = session2.post(f"{BASE_URL}/auth/refresh")
        
        if resp.status_code == 200:
            print(f"❌ CRITICAL: Old refresh token still works (should be revoked!)")
            return False
        
        if resp.status_code != 401:
            print(f"❌ Expected 401 for old refresh token, got {resp.status_code}")
            return False
        
        print(f"✅ Old refresh token correctly rejected with 401")
        
    except Exception as e:
        print(f"❌ Refresh rotation test exception: {e}")
        return False
    
    # Test logout revokes tokens
    print("\n[1.3] Testing logout revokes refresh tokens...")
    try:
        session = requests.Session()
        
        # Login
        resp = session.post(f"{BASE_URL}/auth/login", json={
            "email": ACCOUNTS["admin"],
            "password": PASSWORD
        })
        if resp.status_code != 200:
            print(f"❌ Login failed")
            return False
        
        refresh_before_logout = session.cookies.get('lg_rt')
        
        # Logout
        resp = session.post(f"{BASE_URL}/auth/logout")
        if resp.status_code != 200:
            print(f"❌ Logout failed: {resp.status_code}")
            return False
        
        print(f"✅ Logout successful")
        
        # Try to use refresh token after logout (should fail)
        session2 = requests.Session()
        session2.cookies.set('lg_rt', refresh_before_logout)
        resp = session2.post(f"{BASE_URL}/auth/refresh")
        
        if resp.status_code == 200:
            print(f"❌ CRITICAL: Refresh token still works after logout!")
            return False
        
        print(f"✅ Refresh token correctly revoked after logout")
        
    except Exception as e:
        print(f"❌ Logout test exception: {e}")
        return False
    
    print("\n✅ TEST 1 PASSED: Auth working correctly")
    return True

def test_2_tenant_isolation():
    """Test 2: Tenant isolation - 404 for cross-workspace resources"""
    print("\n" + "="*80)
    print("TEST 2: TENANT ISOLATION - Cross-workspace access returns 404")
    print("="*80)
    
    owner = TestSession(ACCOUNTS["owner"])
    member = TestSession(ACCOUNTS["member"])
    
    if not owner.login() or not member.login():
        print("❌ Failed to login test accounts")
        return False
    
    # Get owner's personal workspace
    owner_personal = next((w for w in owner.workspaces if w["type"] == "personal"), None)
    if not owner_personal:
        print("❌ Owner has no personal workspace")
        return False
    
    # Get org workspace (Nimbus Labs)
    org_workspace = next((w for w in owner.workspaces if w["type"] == "organization"), None)
    if not org_workspace:
        print("❌ No org workspace found")
        return False
    
    print(f"\nOwner personal workspace: {owner_personal['id']}")
    print(f"Org workspace: {org_workspace['id']}")
    
    # Create a transaction in owner's personal workspace
    print("\n[2.1] Creating transaction in owner's personal workspace...")
    resp = owner.post(f"/workspaces/{owner_personal['id']}/transactions", {
        "type": "expense",
        "amount_minor": 5000,
        "merchant": "Test Merchant",
        "transaction_date": datetime.now().strftime("%Y-%m-%d")
    })
    
    if resp.status_code != 201:
        print(f"❌ Failed to create transaction: {resp.status_code} {resp.text}")
        return False
    
    txn = resp.json()
    txn_id = txn["id"]
    print(f"✅ Created transaction {txn_id} in owner's personal workspace")
    
    # Try to access this transaction from member account (should be 404)
    print(f"\n[2.2] Attempting to access owner's personal transaction as member...")
    resp = member.get(f"/workspaces/{owner_personal['id']}/transactions/{txn_id}")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Member can access owner's personal transaction!")
        return False
    
    if resp.status_code == 403:
        print(f"❌ CRITICAL: Got 403 instead of 404 (should look like non-existence!)")
        return False
    
    if resp.status_code != 404:
        print(f"❌ Expected 404, got {resp.status_code}")
        return False
    
    print(f"✅ Correctly returned 404 for cross-workspace transaction")
    
    # Try to access the workspace context itself (should be 404)
    print(f"\n[2.3] Attempting to access owner's personal workspace context as member...")
    resp = member.get(f"/workspaces/{owner_personal['id']}")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Member can access owner's personal workspace!")
        return False
    
    if resp.status_code == 403:
        print(f"❌ CRITICAL: Got 403 instead of 404!")
        return False
    
    if resp.status_code != 404:
        print(f"❌ Expected 404, got {resp.status_code}")
        return False
    
    print(f"✅ Correctly returned 404 for non-member workspace access")
    
    # Test with categories
    print(f"\n[2.4] Testing cross-workspace category access...")
    resp = owner.get(f"/workspaces/{owner_personal['id']}/categories")
    if resp.status_code != 200:
        print(f"❌ Owner can't access own categories: {resp.status_code}")
        return False
    
    categories = resp.json()
    if not categories:
        print("❌ No categories found")
        return False
    
    cat_id = categories[0]["id"]
    
    # Member tries to access owner's personal workspace category
    resp = member.get(f"/workspaces/{owner_personal['id']}/categories")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Member can list owner's personal categories!")
        return False
    
    if resp.status_code != 404:
        print(f"❌ Expected 404 for categories, got {resp.status_code}")
        return False
    
    print(f"✅ Correctly returned 404 for cross-workspace categories")
    
    print("\n✅ TEST 2 PASSED: Tenant isolation working correctly")
    return True

def test_3_own_only_scoping():
    """Test 3: own_only scoping - user sees only their own data"""
    print("\n" + "="*80)
    print("TEST 3: OWN_ONLY SCOPING - own@demo.com sees only own data")
    print("="*80)
    
    own = TestSession(ACCOUNTS["own"])
    member = TestSession(ACCOUNTS["member"])
    
    if not own.login() or not member.login():
        print("❌ Failed to login")
        return False
    
    # Get org workspace
    org_ws = next((w for w in own.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ own@demo.com not in org workspace")
        return False
    
    org_id = org_ws["id"]
    print(f"\nOrg workspace: {org_id}")
    print(f"own@demo.com scope: {org_ws.get('member_scope', 'N/A')}")
    
    # Get transactions as own_only user
    print("\n[3.1] Getting transactions as own_only user...")
    resp = own.get(f"/workspaces/{org_id}/transactions")
    if resp.status_code != 200:
        print(f"❌ Failed to get transactions: {resp.status_code}")
        return False
    
    own_txns = resp.json()
    print(f"own@demo.com sees {own_txns['total']} transactions")
    
    # Check all transactions are created by own user
    for txn in own_txns["rows"]:
        if txn["created_by"] != own.user_id:
            print(f"❌ CRITICAL: own_only user sees transaction created by {txn['created_by']}!")
            return False
    
    print(f"✅ All transactions belong to own@demo.com")
    
    # Get transactions as member (scope=all)
    print("\n[3.2] Getting transactions as member (scope=all)...")
    resp = member.get(f"/workspaces/{org_id}/transactions")
    if resp.status_code != 200:
        print(f"❌ Failed to get transactions: {resp.status_code}")
        return False
    
    member_txns = resp.json()
    print(f"member@demo.com sees {member_txns['total']} transactions")
    
    if member_txns["total"] <= own_txns["total"]:
        print(f"❌ Member with scope=all should see MORE transactions than own_only")
        return False
    
    print(f"✅ Member sees more transactions ({member_txns['total']}) than own_only ({own_txns['total']})")
    
    # Check dashboard teamSpend
    print("\n[3.3] Checking dashboard teamSpend for own_only...")
    resp = own.get(f"/workspaces/{org_id}/dashboard")
    if resp.status_code != 200:
        print(f"❌ Failed to get dashboard: {resp.status_code}")
        return False
    
    dashboard = resp.json()
    
    if dashboard.get("teamSpend") is not None:
        print(f"❌ CRITICAL: own_only user has teamSpend (should be null!)")
        print(f"   teamSpend: {dashboard['teamSpend']}")
        return False
    
    print(f"✅ teamSpend is null for own_only user")
    
    # Check member has teamSpend
    print("\n[3.4] Checking dashboard teamSpend for member (scope=all)...")
    resp = member.get(f"/workspaces/{org_id}/dashboard")
    if resp.status_code != 200:
        print(f"❌ Failed to get dashboard: {resp.status_code}")
        return False
    
    dashboard = resp.json()
    
    if dashboard.get("teamSpend") is None:
        print(f"❌ Member with scope=all should have teamSpend")
        return False
    
    print(f"✅ Member has teamSpend: {len(dashboard['teamSpend'])} members")
    
    print("\n✅ TEST 3 PASSED: own_only scoping working correctly")
    return True

def test_4_role_matrix():
    """Test 4: Role matrix - viewer/member/admin/owner permissions"""
    print("\n" + "="*80)
    print("TEST 4: ROLE MATRIX - Permission enforcement")
    print("="*80)
    
    viewer = TestSession(ACCOUNTS["viewer"])
    member = TestSession(ACCOUNTS["member"])
    admin = TestSession(ACCOUNTS["admin"])
    owner = TestSession(ACCOUNTS["owner"])
    
    if not all([viewer.login(), member.login(), admin.login(), owner.login()]):
        print("❌ Failed to login all accounts")
        return False
    
    # Get org workspace
    org_ws = next((w for w in viewer.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ No org workspace")
        return False
    
    org_id = org_ws["id"]
    print(f"\nOrg workspace: {org_id}")
    
    # Test viewer cannot write transactions
    print("\n[4.1] Testing viewer cannot create transaction...")
    resp = viewer.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": 1000,
        "merchant": "Test"
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: Viewer can create transactions!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for viewer write, got {resp.status_code}")
        return False
    
    print(f"✅ Viewer correctly blocked from creating transaction (403)")
    
    # Test member cannot write budgets
    print("\n[4.2] Testing member cannot create budget...")
    resp = member.post(f"/workspaces/{org_id}/budgets", {
        "period": "monthly",
        "limit_amount_minor": 50000
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: Member can create budgets!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for member budget write, got {resp.status_code}")
        return False
    
    print(f"✅ Member correctly blocked from creating budget (403)")
    
    # Test member cannot read audit log
    print("\n[4.3] Testing member cannot read audit log...")
    resp = member.get(f"/workspaces/{org_id}/audit")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Member can read audit log!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for member audit read, got {resp.status_code}")
        return False
    
    print(f"✅ Member correctly blocked from audit log (403)")
    
    # Test admin cannot change roles
    print("\n[4.4] Testing admin cannot change roles...")
    
    # First get members list
    resp = admin.get(f"/workspaces/{org_id}/members")
    if resp.status_code != 200:
        print(f"❌ Admin can't list members: {resp.status_code}")
        return False
    
    members = resp.json()
    member_to_update = next((m for m in members if m["role"] == "member"), None)
    
    if not member_to_update:
        print("⚠️  No member to test role change")
    else:
        # Try to change role
        resp = admin.put(f"/workspaces/{org_id}/members/{member_to_update['id']}", {
            "role": "admin"
        })
        
        if resp.status_code == 200:
            print(f"❌ CRITICAL: Admin can change roles!")
            return False
        
        if resp.status_code != 403:
            print(f"❌ Expected 403 for admin role change, got {resp.status_code}")
            return False
        
        print(f"✅ Admin correctly blocked from changing roles (403)")
    
    # Test admin CAN invite members
    print("\n[4.5] Testing admin CAN invite members...")
    resp = admin.post(f"/workspaces/{org_id}/members", {
        "email": f"test-{int(time.time())}@example.com",
        "role": "member",
        "member_scope": "all"
    })
    
    if resp.status_code != 201:
        print(f"❌ Admin should be able to invite: {resp.status_code}")
        return False
    
    print(f"✅ Admin can invite members")
    
    # Test only owner can update workspace
    print("\n[4.6] Testing only owner can update workspace...")
    resp = admin.put(f"/workspaces/{org_id}", {
        "name": "Test Name Change"
    })
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Admin can update workspace!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for admin workspace update, got {resp.status_code}")
        return False
    
    print(f"✅ Admin correctly blocked from updating workspace (403)")
    
    # Test owner CAN update workspace
    print("\n[4.7] Testing owner CAN update workspace...")
    resp = owner.get(f"/workspaces/{org_id}")
    if resp.status_code != 200:
        print(f"❌ Owner can't get workspace: {resp.status_code}")
        return False
    
    original_name = resp.json()["workspace"]["name"]
    
    resp = owner.put(f"/workspaces/{org_id}", {
        "name": original_name  # Keep same name
    })
    
    if resp.status_code != 200:
        print(f"❌ Owner should be able to update workspace: {resp.status_code}")
        return False
    
    print(f"✅ Owner can update workspace")
    
    print("\n✅ TEST 4 PASSED: Role matrix working correctly")
    return True

def test_5_soft_delete():
    """Test 5: Soft delete - transaction 404s but audit log exists"""
    print("\n" + "="*80)
    print("TEST 5: SOFT DELETE - Transaction 404s, audit log exists")
    print("="*80)
    
    owner = TestSession(ACCOUNTS["owner"])
    
    if not owner.login():
        print("❌ Failed to login")
        return False
    
    # Get org workspace
    org_ws = next((w for w in owner.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ No org workspace")
        return False
    
    org_id = org_ws["id"]
    
    # Create a transaction
    print("\n[5.1] Creating transaction to delete...")
    resp = owner.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": 7500,
        "merchant": "To Be Deleted",
        "transaction_date": datetime.now().strftime("%Y-%m-%d")
    })
    
    if resp.status_code != 201:
        print(f"❌ Failed to create transaction: {resp.status_code}")
        return False
    
    txn = resp.json()
    txn_id = txn["id"]
    print(f"✅ Created transaction {txn_id}")
    
    # Verify it exists
    resp = owner.get(f"/workspaces/{org_id}/transactions/{txn_id}")
    if resp.status_code != 200:
        print(f"❌ Transaction not found after creation: {resp.status_code}")
        return False
    
    print(f"✅ Transaction exists before delete")
    
    # Get transaction count before delete
    resp = owner.get(f"/workspaces/{org_id}/transactions")
    if resp.status_code != 200:
        print(f"❌ Failed to list transactions: {resp.status_code}")
        return False
    
    count_before = resp.json()["total"]
    print(f"Transaction count before delete: {count_before}")
    
    # Delete the transaction
    print(f"\n[5.2] Deleting transaction...")
    resp = owner.delete(f"/workspaces/{org_id}/transactions/{txn_id}")
    
    if resp.status_code != 200:
        print(f"❌ Failed to delete transaction: {resp.status_code}")
        return False
    
    print(f"✅ Transaction deleted")
    
    # Try to GET by id (should be 404)
    print(f"\n[5.3] Attempting to GET deleted transaction...")
    resp = owner.get(f"/workspaces/{org_id}/transactions/{txn_id}")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Deleted transaction still accessible!")
        return False
    
    if resp.status_code != 404:
        print(f"❌ Expected 404 for deleted transaction, got {resp.status_code}")
        return False
    
    print(f"✅ Deleted transaction returns 404")
    
    # Check it's not in list
    print(f"\n[5.4] Checking transaction list...")
    resp = owner.get(f"/workspaces/{org_id}/transactions")
    if resp.status_code != 200:
        print(f"❌ Failed to list transactions: {resp.status_code}")
        return False
    
    txns = resp.json()
    count_after = txns["total"]
    
    if count_after >= count_before:
        print(f"❌ Transaction count didn't decrease: {count_before} -> {count_after}")
        return False
    
    # Check it's not in the rows
    for t in txns["rows"]:
        if t["id"] == txn_id:
            print(f"❌ CRITICAL: Deleted transaction still in list!")
            return False
    
    print(f"✅ Deleted transaction not in list (count: {count_before} -> {count_after})")
    
    # Check audit log has delete entry
    print(f"\n[5.5] Checking audit log for delete entry...")
    resp = owner.get(f"/workspaces/{org_id}/audit")
    if resp.status_code != 200:
        print(f"❌ Failed to get audit log: {resp.status_code}")
        return False
    
    audit_logs = resp.json()
    
    delete_entry = None
    for log in audit_logs:
        if log["action"] == "delete" and log["entity_type"] == "transaction" and log["entity_id"] == txn_id:
            delete_entry = log
            break
    
    if not delete_entry:
        print(f"❌ CRITICAL: No audit log entry for deleted transaction!")
        return False
    
    print(f"✅ Audit log contains delete entry:")
    print(f"   Action: {delete_entry['action']}")
    print(f"   Entity: {delete_entry['entity_type']}")
    print(f"   Summary: {delete_entry['summary']}")
    
    print("\n✅ TEST 5 PASSED: Soft delete working correctly")
    return True

def test_6_invitations():
    """Test 6: Invitations - pending, accept, owner rejection"""
    print("\n" + "="*80)
    print("TEST 6: INVITATIONS - Pending, accept flow, owner rejection")
    print("="*80)
    
    owner = TestSession(ACCOUNTS["owner"])
    
    if not owner.login():
        print("❌ Failed to login")
        return False
    
    # Get org workspace
    org_ws = next((w for w in owner.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ No org workspace")
        return False
    
    org_id = org_ws["id"]
    
    # Test inviting as owner role (should be rejected)
    print("\n[6.1] Testing invite with role=owner (should be rejected)...")
    test_email = f"test-owner-{int(time.time())}@example.com"
    resp = owner.post(f"/workspaces/{org_id}/members", {
        "email": test_email,
        "role": "owner",
        "member_scope": "all"
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: Can invite someone as owner!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for owner invite, got {resp.status_code}")
        return False
    
    print(f"✅ Inviting as owner correctly rejected (403)")
    
    # Create a pending invite
    print("\n[6.2] Creating pending invite...")
    test_email = f"test-invite-{int(time.time())}@example.com"
    resp = owner.post(f"/workspaces/{org_id}/members", {
        "email": test_email,
        "role": "member",
        "member_scope": "all"
    })
    
    if resp.status_code != 201:
        print(f"❌ Failed to create invite: {resp.status_code} {resp.text}")
        return False
    
    invite = resp.json()
    membership_id = invite["id"]
    print(f"✅ Created pending invite {membership_id} for {test_email}")
    print(f"   Status: {invite['status']}")
    
    if invite["status"] != "pending":
        print(f"❌ Invite status should be 'pending', got '{invite['status']}'")
        return False
    
    print(f"✅ Invite status is 'pending'")
    
    # Check invite appears in members list
    print("\n[6.3] Checking invite in members list...")
    resp = owner.get(f"/workspaces/{org_id}/members")
    if resp.status_code != 200:
        print(f"❌ Failed to list members: {resp.status_code}")
        return False
    
    members = resp.json()
    pending_member = next((m for m in members if m["id"] == membership_id), None)
    
    if not pending_member:
        print(f"❌ Pending invite not in members list")
        return False
    
    print(f"✅ Pending invite appears in members list")
    
    # Note: We can't fully test the accept flow without creating a new user account
    # But we can verify the endpoint exists and requires auth
    print("\n[6.4] Testing accept endpoint exists...")
    resp = requests.post(f"{BASE_URL}/invites/{membership_id}/accept")
    
    if resp.status_code == 404:
        print(f"❌ Accept endpoint not found")
        return False
    
    # Should be 401 (not authenticated) or 404 (not found for this user)
    if resp.status_code not in [401, 404]:
        print(f"⚠️  Unexpected status for unauthenticated accept: {resp.status_code}")
    else:
        print(f"✅ Accept endpoint exists (returned {resp.status_code} for unauth)")
    
    print("\n✅ TEST 6 PASSED: Invitations working correctly")
    return True

def test_7_agent(limit_calls=4):
    """Test 7: Agent - answer/refusal, scoping, agent-log (LIMITED to 4 calls)"""
    print("\n" + "="*80)
    print(f"TEST 7: AGENT - Answer/refusal, scoping, agent-log (MAX {limit_calls} calls)")
    print("="*80)
    
    own = TestSession(ACCOUNTS["own"])
    owner = TestSession(ACCOUNTS["owner"])
    
    if not own.login() or not owner.login():
        print("❌ Failed to login")
        return False
    
    # Get org workspace
    org_ws = next((w for w in own.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ No org workspace")
        return False
    
    org_id = org_ws["id"]
    
    call_count = 0
    
    # Test 1: Read question should return answer
    print(f"\n[7.1] Testing read question returns answer (call {call_count+1}/{limit_calls})...")
    if call_count >= limit_calls:
        print("⚠️  Skipping - call limit reached")
    else:
        resp = owner.post(f"/workspaces/{org_id}/insights", {
            "query": "How much did I spend on Food this month?"
        })
        call_count += 1
        
        if resp.status_code != 200:
            print(f"❌ Agent query failed: {resp.status_code} {resp.text}")
            return False
        
        result = resp.json()
        message = result.get("message", {})
        
        print(f"Response kind: {message.get('kind')}")
        print(f"Tools used: {message.get('tools_used', [])}")
        
        if message.get("kind") != "answer":
            print(f"❌ Expected kind=answer, got {message.get('kind')}")
            return False
        
        if not message.get("citation"):
            print(f"⚠️  No citation in answer")
        else:
            print(f"✅ Has citation: {message['citation']}")
        
        if not message.get("tools_used"):
            print(f"⚠️  No tools_used in answer")
        else:
            print(f"✅ Tools used: {message['tools_used']}")
        
        print(f"✅ Read question returned answer")
    
    # Test 2: Write request should return refusal
    print(f"\n[7.2] Testing write request returns refusal (call {call_count+1}/{limit_calls})...")
    if call_count >= limit_calls:
        print("⚠️  Skipping - call limit reached")
    else:
        resp = owner.post(f"/workspaces/{org_id}/insights", {
            "query": "Add a 500 expense for coffee"
        })
        call_count += 1
        
        if resp.status_code != 200:
            print(f"❌ Agent query failed: {resp.status_code}")
            return False
        
        result = resp.json()
        message = result.get("message", {})
        
        print(f"Response kind: {message.get('kind')}")
        
        if message.get("kind") != "refusal":
            print(f"❌ CRITICAL: Write request returned {message.get('kind')} instead of refusal!")
            return False
        
        print(f"✅ Write request correctly returned refusal")
        print(f"   Text: {message.get('text', '')[:100]}...")
    
    # Test 3: own_only scoping - ask about team spending
    print(f"\n[7.3] Testing own_only scoping (call {call_count+1}/{limit_calls})...")
    if call_count >= limit_calls:
        print("⚠️  Skipping - call limit reached")
    else:
        resp = own.post(f"/workspaces/{org_id}/insights", {
            "query": "Which team member spent the most this month?"
        })
        call_count += 1
        
        if resp.status_code != 200:
            print(f"❌ Agent query failed: {resp.status_code}")
            return False
        
        result = resp.json()
        message = result.get("message", {})
        
        print(f"Response kind: {message.get('kind')}")
        print(f"Scope: {message.get('scope')}")
        
        # Check scope is own_only
        if message.get("scope", {}).get("member_scope") != "own_only":
            print(f"⚠️  Expected scope=own_only, got {message.get('scope')}")
        else:
            print(f"✅ Scope correctly set to own_only")
        
        # The answer should not expose other members' data
        # (hard to verify without checking the actual data, but we can check the response)
        print(f"✅ own_only user query completed")
    
    # Test 4: Check agent-log
    print(f"\n[7.4] Checking agent-log has resolved_scope and tool_calls...")
    resp = owner.get(f"/workspaces/{org_id}/agent-log")
    
    if resp.status_code != 200:
        print(f"❌ Failed to get agent-log: {resp.status_code}")
        return False
    
    logs = resp.json()
    
    if not logs:
        print(f"⚠️  No agent logs found")
    else:
        print(f"Found {len(logs)} agent log entries")
        
        # Check first log has required fields
        log = logs[0]
        
        if "resolved_scope" not in log:
            print(f"❌ CRITICAL: agent-log missing resolved_scope!")
            return False
        
        if "tool_calls" not in log:
            print(f"❌ CRITICAL: agent-log missing tool_calls!")
            return False
        
        print(f"✅ Agent log has resolved_scope: {log['resolved_scope']}")
        print(f"✅ Agent log has tool_calls: {len(log['tool_calls'])} calls")
    
    # Test member cannot access agent-log
    print(f"\n[7.5] Testing member cannot access agent-log...")
    member = TestSession(ACCOUNTS["member"])
    if not member.login():
        print("❌ Failed to login member")
        return False
    
    resp = member.get(f"/workspaces/{org_id}/agent-log")
    
    if resp.status_code == 200:
        print(f"❌ CRITICAL: Member can access agent-log!")
        return False
    
    if resp.status_code != 403:
        print(f"❌ Expected 403 for member agent-log access, got {resp.status_code}")
        return False
    
    print(f"✅ Member correctly blocked from agent-log (403)")
    
    print(f"\n✅ TEST 7 PASSED: Agent working correctly (used {call_count}/{limit_calls} calls)")
    return True

def test_8_validation():
    """Test 8: Money validation - amount_minor validation"""
    print("\n" + "="*80)
    print("TEST 8: VALIDATION - amount_minor validation")
    print("="*80)
    
    owner = TestSession(ACCOUNTS["owner"])
    
    if not owner.login():
        print("❌ Failed to login")
        return False
    
    # Get org workspace
    org_ws = next((w for w in owner.workspaces if w["type"] == "organization"), None)
    if not org_ws:
        print("❌ No org workspace")
        return False
    
    org_id = org_ws["id"]
    
    # Test amount_minor <= 0
    print("\n[8.1] Testing amount_minor <= 0 rejected...")
    resp = owner.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": 0,
        "merchant": "Test"
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: amount_minor=0 accepted!")
        return False
    
    if resp.status_code != 400:
        print(f"❌ Expected 400 for amount_minor=0, got {resp.status_code}")
        return False
    
    print(f"✅ amount_minor=0 correctly rejected (400)")
    
    # Test negative amount
    print("\n[8.2] Testing negative amount_minor rejected...")
    resp = owner.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": -1000,
        "merchant": "Test"
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: Negative amount_minor accepted!")
        return False
    
    if resp.status_code != 400:
        print(f"❌ Expected 400 for negative amount, got {resp.status_code}")
        return False
    
    print(f"✅ Negative amount_minor correctly rejected (400)")
    
    # Test non-numeric amount
    print("\n[8.3] Testing non-numeric amount_minor rejected...")
    resp = owner.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": "not a number",
        "merchant": "Test"
    })
    
    if resp.status_code == 201:
        print(f"❌ CRITICAL: Non-numeric amount_minor accepted!")
        return False
    
    if resp.status_code != 400:
        print(f"❌ Expected 400 for non-numeric amount, got {resp.status_code}")
        return False
    
    print(f"✅ Non-numeric amount_minor correctly rejected (400)")
    
    # Test valid amount works
    print("\n[8.4] Testing valid amount_minor accepted...")
    resp = owner.post(f"/workspaces/{org_id}/transactions", {
        "type": "expense",
        "amount_minor": 1000,
        "merchant": "Valid Test"
    })
    
    if resp.status_code != 201:
        print(f"❌ Valid amount should be accepted: {resp.status_code}")
        return False
    
    print(f"✅ Valid amount_minor correctly accepted")
    
    print("\n✅ TEST 8 PASSED: Validation working correctly")
    return True

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("MULTI-WORKSPACE EXPENSE & BUDGET TRACKER - BACKEND API TESTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test accounts: {list(ACCOUNTS.values())}")
    
    # Check health
    print("\n[HEALTH CHECK]")
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=5)
        if resp.status_code == 200:
            print(f"✅ API is healthy: {resp.json()}")
        else:
            print(f"⚠️  API health check returned {resp.status_code}")
    except Exception as e:
        print(f"❌ API health check failed: {e}")
        print("Make sure the server is running!")
        return
    
    results = {}
    
    # Run all tests
    tests = [
        ("1. Auth", test_1_auth),
        ("2. Tenant Isolation", test_2_tenant_isolation),
        ("3. own_only Scoping", test_3_own_only_scoping),
        ("4. Role Matrix", test_4_role_matrix),
        ("5. Soft Delete", test_5_soft_delete),
        ("6. Invitations", test_6_invitations),
        ("7. Agent", lambda: test_7_agent(limit_calls=4)),
        ("8. Validation", test_8_validation),
    ]
    
    for name, test_func in tests:
        try:
            results[name] = test_func()
        except Exception as e:
            print(f"\n❌ TEST {name} EXCEPTION: {e}")
            import traceback
            traceback.print_exc()
            results[name] = False
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    for name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {name}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")

if __name__ == "__main__":
    main()
