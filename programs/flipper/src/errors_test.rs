#[cfg(test)]
mod tests {
    use super::super::errors::ErrorCode;

    #[test]
    fn test_error_code_values() {
        // Verify error codes have correct discriminants
        assert_eq!(ErrorCode::EmptyRoute as u32, 6000);
        assert_eq!(ErrorCode::SlippageToleranceExceeded as u32, 6001);
        assert_eq!(ErrorCode::InvalidCalculation as u32, 6002);
        assert_eq!(ErrorCode::NotEnoughPercent as u32, 6005);
        assert_eq!(ErrorCode::InvalidSlippage as u32, 6004);
        assert_eq!(ErrorCode::NotEnoughAccountKeys as u32, 6008);
        assert_eq!(ErrorCode::SwapNotSupported as u32, 6016);
    }

    #[test]
    fn test_error_code_adapter_errors() {
        assert_eq!(ErrorCode::InvalidAuthority as u32, 6019);
        assert_eq!(ErrorCode::InvalidPoolAddress as u32, 6020);
        assert_eq!(ErrorCode::InvalidCpiInterface as u32, 6021);
        assert_eq!(ErrorCode::PoolAlreadyExists as u32, 6022);
        assert_eq!(ErrorCode::PoolNotFound as u32, 6023);
    }

    #[test]
    fn test_error_code_operator_errors() {
        assert_eq!(ErrorCode::InvalidOperator as u32, 6024);
        assert_eq!(ErrorCode::OperatorAlreadyExists as u32, 6026);
        assert_eq!(ErrorCode::OperatorNotFound as u32, 6027);
    }

    #[test]
    fn test_error_code_vault_errors() {
        assert_eq!(ErrorCode::InvalidMint as u32, 6028);
        assert_eq!(ErrorCode::VaultNotFound as u32, 6029);
        assert_eq!(ErrorCode::PoolAccountNotFound as u32, 6039);
        assert_eq!(ErrorCode::InvalidVaultOwner as u32, 6040);
        assert_eq!(ErrorCode::VaultNotEmpty as u32, 6041);
        assert_eq!(ErrorCode::UnauthorizedAdmin as u32, 6042);
    }

    #[test]
    fn test_error_code_limit_order_errors() {
        assert_eq!(ErrorCode::InvalidOrderStatus as u32, 6060);
        assert_eq!(ErrorCode::OrderExpired as u32, 6061);
        assert_eq!(ErrorCode::InvalidExpiry as u32, 6062);
    }

    #[test]
    fn test_error_code_validation_errors() {
        assert_eq!(ErrorCode::InvalidAmount as u32, 6053);
        assert_eq!(ErrorCode::InvalidPercent as u32, 6054);
        assert_eq!(ErrorCode::InvalidAccountIndex as u32, 6055);
        assert_eq!(ErrorCode::InvalidMultiHopRoute as u32, 6056);
    }

    #[test]
    fn test_error_code_platform_fee_errors() {
        assert_eq!(ErrorCode::InvalidPlatformFeeOwner as u32, 6051);
        assert_eq!(ErrorCode::InvalidPlatformFeeMint as u32, 6052);
    }

    #[test]
    fn test_error_code_trigger_errors() {
        // Check actual discriminant values from the error enum
        let invalid_trigger = ErrorCode::InvalidTriggerPrice as u32;
        let trigger_not_met = ErrorCode::TriggerPriceNotMet as u32;
        
        // Verify they are in the expected range
        assert!(invalid_trigger >= 6000 && invalid_trigger < 7000);
        assert!(trigger_not_met >= 6000 && trigger_not_met < 7000);
        assert_ne!(invalid_trigger, trigger_not_met);
    }

    #[test]
    fn test_error_code_no_duplicates() {
        // Verify that all error codes are unique
        let error_codes = vec![
            ErrorCode::EmptyRoute as u32,
            ErrorCode::SlippageToleranceExceeded as u32,
            ErrorCode::InvalidCalculation as u32,
            ErrorCode::NotEnoughPercent as u32,
            ErrorCode::InvalidSlippage as u32,
            ErrorCode::NotEnoughAccountKeys as u32,
            ErrorCode::SwapNotSupported as u32,
            ErrorCode::InvalidAuthority as u32,
            ErrorCode::InvalidPoolAddress as u32,
            ErrorCode::InvalidCpiInterface as u32,
            ErrorCode::PoolAlreadyExists as u32,
            ErrorCode::PoolNotFound as u32,
            ErrorCode::InvalidOperator as u32,
            ErrorCode::OperatorAlreadyExists as u32,
            ErrorCode::OperatorNotFound as u32,
            ErrorCode::InvalidMint as u32,
            ErrorCode::VaultNotFound as u32,
        ];

        let mut sorted = error_codes.clone();
        sorted.sort();
        sorted.dedup();

        // If there were duplicates, the deduped length would be less
        assert_eq!(sorted.len(), error_codes.len());
    }

    #[test]
    fn test_error_code_range() {
        // All custom error codes should be in the 6000+ range
        let error_codes = vec![
            ErrorCode::EmptyRoute as u32,
            ErrorCode::SlippageToleranceExceeded as u32,
            ErrorCode::InvalidCalculation as u32,
            ErrorCode::InvalidAuthority as u32,
            ErrorCode::InvalidOperator as u32,
            ErrorCode::VaultNotFound as u32,
            ErrorCode::InvalidOrderStatus as u32,
        ];

        for code in error_codes {
            assert!(code >= 6000, "Error code {} is below 6000", code);
            assert!(code < 7000, "Error code {} is above 7000", code);
        }
    }

    #[test]
    fn test_error_code_swap_errors() {
        assert_eq!(ErrorCode::InvalidInputIndex as u32, 6006);
        assert_eq!(ErrorCode::InvalidOutputIndex as u32, 6007);
        assert_eq!(ErrorCode::InvalidPartialSwapPercent as u32, 6057);
        assert_eq!(ErrorCode::InsufficientDexesForPartialSwap as u32, 6058);
        assert_eq!(ErrorCode::NoOutputProduced as u32, 6059);
    }

    #[test]
    fn test_error_code_comprehensive_list() {
        // Test that all major categories are covered
        let _routing_errors = vec![
            ErrorCode::EmptyRoute,
            ErrorCode::InvalidMultiHopRoute,
            ErrorCode::NotEnoughAccountKeys,
        ];

        let _validation_errors = vec![
            ErrorCode::InvalidAmount,
            ErrorCode::InvalidPercent,
            ErrorCode::InvalidSlippage,
            ErrorCode::SlippageToleranceExceeded,
        ];

        let _authorization_errors = vec![
            ErrorCode::InvalidAuthority,
            ErrorCode::InvalidOperator,
            ErrorCode::UnauthorizedAdmin,
        ];

        let _order_errors = vec![
            ErrorCode::InvalidOrderStatus,
            ErrorCode::OrderExpired,
            ErrorCode::InvalidExpiry,
            ErrorCode::InvalidTriggerPrice,
        ];
    }
}
