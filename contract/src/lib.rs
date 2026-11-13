use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseResult, PublicKey,
};

const DAY_NS: u64 = 86_400_000_000_000;
const MAX_INVOICE_TTL_NS: u64 = 7 * DAY_NS;
const GAS_RESERVE: u128 = 100_000_000_000_000_000_000_000;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum InvoiceStatus {
    Approved,
    Pending,
    Paid,
    Failed,
    Revoked,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Invoice {
    pub receiver_id: AccountId,
    pub amount: U128,
    pub expires_at_ns: U64,
    pub status: InvoiceStatus,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VaultStatus {
    pub account_id: AccountId,
    pub owner_id: AccountId,
    pub agent_public_key: Option<PublicKey>,
    pub paused: bool,
    pub per_payment_limit: U128,
    pub daily_limit: U128,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub balance: U128,
    pub current_time_ns: U64,
    pub invoices_approved: u64,
    pub payments_succeeded: u64,
    pub payments_failed: u64,
    pub total_paid: U128,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn settle_payment(&mut self, invoice_id: String, reserved_day: U64) -> bool;
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct IntentGuard {
    owner_id: AccountId,
    agent_public_key: Option<PublicKey>,
    paused: bool,
    per_payment_limit: u128,
    daily_limit: u128,
    spend_day: u64,
    spent_today: u128,
    invoices: LookupMap<String, Invoice>,
    invoices_approved: u64,
    payments_succeeded: u64,
    payments_failed: u64,
    total_paid: u128,
}

#[near_bindgen]
impl IntentGuard {
    #[init]
    pub fn new(
        owner_id: AccountId,
        agent_public_key: PublicKey,
        per_payment_limit: U128,
        daily_limit: U128,
    ) -> Self {
        Self::assert_limits(per_payment_limit.0, daily_limit.0);
        Self {
            owner_id,
            agent_public_key: Some(agent_public_key),
            paused: false,
            per_payment_limit: per_payment_limit.0,
            daily_limit: daily_limit.0,
            spend_day: env::block_timestamp() / DAY_NS,
            spent_today: 0,
            invoices: LookupMap::new(b"invoices".to_vec()),
            invoices_approved: 0,
            payments_succeeded: 0,
            payments_failed: 0,
            total_paid: 0,
        }
    }

    pub fn approve_invoice(
        &mut self,
        invoice_id: String,
        receiver_id: AccountId,
        amount: U128,
        expires_at_ns: U64,
    ) {
        self.assert_owner();
        Self::assert_invoice_id(&invoice_id);
        assert!(
            self.invoices.get(&invoice_id).is_none(),
            "INVOICE_ID_EXISTS"
        );
        assert!(amount.0 > 0, "INVALID_AMOUNT");
        assert!(amount.0 <= self.per_payment_limit, "PER_PAYMENT_LIMIT");
        let now = env::block_timestamp();
        assert!(expires_at_ns.0 > now, "INVALID_EXPIRY");
        assert!(
            expires_at_ns.0 - now <= MAX_INVOICE_TTL_NS,
            "EXPIRY_TOO_FAR"
        );
        let invoice = Invoice {
            receiver_id,
            amount,
            expires_at_ns,
            status: InvoiceStatus::Approved,
        };
        self.invoices.insert(&invoice_id, &invoice);
        self.invoices_approved += 1;
        emit(
            "invoice_approved",
            near_sdk::serde_json::json!({
                "invoice_id": invoice_id,
                "receiver_id": invoice.receiver_id,
                "amount": invoice.amount,
                "expires_at_ns": invoice.expires_at_ns,
            }),
        );
    }

    pub fn execute_payment(
        &mut self,
        invoice_id: String,
        receiver_id: AccountId,
        amount: U128,
    ) -> Promise {
        assert!(!self.paused, "VAULT_PAUSED");
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "DIRECT_AGENT_CALL_REQUIRED"
        );
        assert_eq!(
            env::signer_account_id(),
            env::current_account_id(),
            "DIRECT_AGENT_CALL_REQUIRED"
        );
        let agent_key = self.agent_public_key.as_ref().expect("AGENT_KEY_REVOKED");
        assert_eq!(
            &env::signer_account_pk(),
            agent_key,
            "UNAUTHORIZED_AGENT_KEY"
        );
        Self::assert_invoice_id(&invoice_id);
        let mut invoice = self.invoices.get(&invoice_id).expect("INVOICE_NOT_FOUND");
        assert!(
            invoice.status == InvoiceStatus::Approved,
            "INVOICE_NOT_ACTIVE"
        );
        assert!(
            env::block_timestamp() < invoice.expires_at_ns.0,
            "INVOICE_EXPIRED"
        );
        assert_eq!(
            receiver_id, invoice.receiver_id,
            "INVOICE_RECIPIENT_MISMATCH"
        );
        assert_eq!(amount.0, invoice.amount.0, "INVOICE_AMOUNT_MISMATCH");
        assert!(amount.0 <= self.per_payment_limit, "PER_PAYMENT_LIMIT");

        let day = env::block_timestamp() / DAY_NS;
        let spent = if self.spend_day == day {
            self.spent_today
        } else {
            0
        };
        let next_spent = spent.checked_add(amount.0).expect("AMOUNT_OVERFLOW");
        assert!(next_spent <= self.daily_limit, "DAILY_LIMIT");
        let storage_reserve = u128::from(env::storage_usage())
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .and_then(|storage| storage.checked_add(GAS_RESERVE))
            .expect("AMOUNT_OVERFLOW");
        let available = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage_reserve);
        assert!(amount.0 <= available, "INSUFFICIENT_VAULT_BALANCE");

        invoice.status = InvoiceStatus::Pending;
        self.invoices.insert(&invoice_id, &invoice);
        self.spend_day = day;
        self.spent_today = next_spent;
        emit(
            "payment_reserved",
            near_sdk::serde_json::json!({
                "invoice_id": invoice_id,
                "receiver_id": receiver_id,
                "amount": amount,
                "day": U64(day),
            }),
        );
        Promise::new(receiver_id)
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .settle_payment(invoice_id, U64(day)),
            )
    }

    #[private]
    pub fn settle_payment(&mut self, invoice_id: String, reserved_day: U64) -> bool {
        assert_eq!(env::promise_results_count(), 1, "INVALID_CALLBACK");
        let mut invoice = self.invoices.get(&invoice_id).expect("INVOICE_NOT_FOUND");
        assert!(
            invoice.status == InvoiceStatus::Pending,
            "INVOICE_NOT_PENDING"
        );
        let succeeded = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if succeeded {
            invoice.status = InvoiceStatus::Paid;
            self.payments_succeeded += 1;
            self.total_paid = self
                .total_paid
                .checked_add(invoice.amount.0)
                .expect("AMOUNT_OVERFLOW");
        } else {
            invoice.status = InvoiceStatus::Failed;
            self.payments_failed += 1;
            if self.spend_day == reserved_day.0 {
                self.spent_today = self
                    .spent_today
                    .checked_sub(invoice.amount.0)
                    .expect("INVALID_RESERVATION");
            }
        }
        self.invoices.insert(&invoice_id, &invoice);
        emit(
            if succeeded {
                "payment_settled"
            } else {
                "payment_failed"
            },
            near_sdk::serde_json::json!({
                "invoice_id": invoice_id,
                "receiver_id": invoice.receiver_id,
                "amount": invoice.amount,
            }),
        );
        succeeded
    }

    pub fn revoke_invoice(&mut self, invoice_id: String) {
        self.assert_owner();
        let mut invoice = self.invoices.get(&invoice_id).expect("INVOICE_NOT_FOUND");
        assert!(
            invoice.status == InvoiceStatus::Approved,
            "INVOICE_NOT_ACTIVE"
        );
        invoice.status = InvoiceStatus::Revoked;
        self.invoices.insert(&invoice_id, &invoice);
        emit(
            "invoice_revoked",
            near_sdk::serde_json::json!({ "invoice_id": invoice_id }),
        );
    }

    pub fn set_policy(&mut self, per_payment_limit: U128, daily_limit: U128) {
        self.assert_owner();
        Self::assert_limits(per_payment_limit.0, daily_limit.0);
        self.per_payment_limit = per_payment_limit.0;
        self.daily_limit = daily_limit.0;
        emit(
            "policy_updated",
            near_sdk::serde_json::json!({
                "per_payment_limit": per_payment_limit,
                "daily_limit": daily_limit,
            }),
        );
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        emit(
            "pause_updated",
            near_sdk::serde_json::json!({ "paused": paused }),
        );
    }

    pub fn set_agent_key(&mut self, agent_public_key: PublicKey) {
        self.assert_owner();
        self.agent_public_key = Some(agent_public_key);
        emit(
            "agent_key_updated",
            near_sdk::serde_json::json!({ "agent_public_key": self.agent_public_key }),
        );
    }

    pub fn revoke_agent_key(&mut self) {
        self.assert_owner();
        self.agent_public_key = None;
        emit("agent_key_revoked", near_sdk::serde_json::json!({}));
    }

    pub fn get_invoice(&self, invoice_id: String) -> Option<Invoice> {
        self.invoices.get(&invoice_id)
    }

    pub fn get_status(&self) -> VaultStatus {
        let spent_today = if self.spend_day == env::block_timestamp() / DAY_NS {
            self.spent_today
        } else {
            0
        };
        VaultStatus {
            account_id: env::current_account_id(),
            owner_id: self.owner_id.clone(),
            agent_public_key: self.agent_public_key.clone(),
            paused: self.paused,
            per_payment_limit: U128(self.per_payment_limit),
            daily_limit: U128(self.daily_limit),
            spent_today: U128(spent_today),
            remaining_today: U128(self.daily_limit.saturating_sub(spent_today)),
            balance: U128(env::account_balance().as_yoctonear()),
            current_time_ns: U64(env::block_timestamp()),
            invoices_approved: self.invoices_approved,
            payments_succeeded: self.payments_succeeded,
            payments_failed: self.payments_failed,
            total_paid: U128(self.total_paid),
        }
    }

    fn assert_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "OWNER_ONLY");
    }

    fn assert_limits(per_payment_limit: u128, daily_limit: u128) {
        assert!(
            per_payment_limit > 0 && daily_limit >= per_payment_limit,
            "INVALID_LIMITS"
        );
    }

    fn assert_invoice_id(invoice_id: &str) {
        assert!(
            !invoice_id.is_empty() && invoice_id.len() <= 64,
            "INVALID_INVOICE_ID"
        );
        assert!(
            invoice_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'),
            "INVALID_INVOICE_ID"
        );
    }
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "intentguard",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}
