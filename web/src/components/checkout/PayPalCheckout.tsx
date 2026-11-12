"use client";

import {
  INSTANCE_LOADING_STATE,
  PayPalOneTimePaymentButton,
  PayPalProvider,
  usePayPal,
} from "@paypal/react-paypal-js/sdk-v6";

type Props = {
  /** Creates the PayPal order on our server and returns its ID. */
  createOrder: () => Promise<{ orderId: string }>;
  /** Asks our server to capture and verify. Tickets exist only if this resolves. */
  onApprove: (data: { orderId: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
};

const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

/** PayPal JS SDK v6 sandbox button. Buyer approval happens in PayPal's own UI. */
export function PayPalCheckout(props: Props) {
  if (!clientId) {
    return (
      <p className="text-sm text-destructive">
        PayPal is not configured: set NEXT_PUBLIC_PAYPAL_CLIENT_ID.
      </p>
    );
  }

  return (
    <PayPalProvider
      clientId={clientId}
      environment="sandbox"
      components={["paypal-payments"]}
      pageType="checkout"
    >
      <SandboxButton {...props} />
    </PayPalProvider>
  );
}

function SandboxButton({ createOrder, onApprove, onCancel, onError, disabled }: Props) {
  const { loadingStatus, error } = usePayPal();

  if (loadingStatus === INSTANCE_LOADING_STATE.PENDING) {
    return <p className="text-sm text-muted-foreground">Loading PayPal sandbox…</p>;
  }
  if (loadingStatus === INSTANCE_LOADING_STATE.REJECTED) {
    return (
      <p className="text-sm text-destructive">
        Could not load the PayPal SDK{error?.message ? `: ${error.message}` : "."}
      </p>
    );
  }

  return (
    <PayPalOneTimePaymentButton
      type="pay"
      disabled={disabled}
      createOrder={createOrder}
      onApprove={({ orderId }) => onApprove({ orderId })}
      onCancel={() => onCancel?.()}
      onError={(err) => onError?.(err instanceof Error ? err : new Error("PayPal checkout failed."))}
    />
  );
}
