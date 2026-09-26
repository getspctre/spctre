-- Internal account grants.
--
-- An internal grant is a tenant an operator provisions for an employee, a
-- tester, or for dogfooding the product against its own control plane. It is
-- not a customer: nobody paid for it, no subscription exists behind it, and
-- nothing about it may ever be billed.
--
-- Before this, such an account could only be created by claiming to be a
-- customer (sales_status 'CUSTOMER'), which left billing unable to tell the
-- two apart. Once retained-event capacity is enforced, an internal grant past
-- its capacity would have an overage charge attempted against a subscription
-- that does not exist.
--
-- Idempotent: the constraint is dropped and recreated, so re-running the
-- migration converges rather than failing on a duplicate constraint.
ALTER TABLE public.tenant_commercial_profile
    DROP CONSTRAINT IF EXISTS tenant_commercial_profile_sales_status_check;

ALTER TABLE public.tenant_commercial_profile
    ADD CONSTRAINT tenant_commercial_profile_sales_status_check CHECK (
        (sales_status = ANY (ARRAY[
            'NONE'::text,
            'REQUESTED'::text,
            'QUALIFIED'::text,
            'CONTRACTING'::text,
            'CUSTOMER'::text,
            'INTERNAL'::text
        ]))
    );
