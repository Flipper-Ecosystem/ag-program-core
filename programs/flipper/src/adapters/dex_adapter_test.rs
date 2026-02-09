#[cfg(test)]
mod tests {
    use super::super::SwapResult;

    #[test]
    fn test_swap_result_creation() {
        let result = SwapResult {
            output_amount: 1000000,
        };

        assert_eq!(result.output_amount, 1000000);
    }

    #[test]
    fn test_swap_result_zero_amount() {
        let result = SwapResult {
            output_amount: 0,
        };

        assert_eq!(result.output_amount, 0);
    }

    #[test]
    fn test_swap_result_max_amount() {
        let result = SwapResult {
            output_amount: u64::MAX,
        };

        assert_eq!(result.output_amount, u64::MAX);
    }

    #[test]
    fn test_swap_result_typical_amounts() {
        let test_cases = vec![
            1,
            100,
            1000,
            1_000_000,
            1_000_000_000,
            1_000_000_000_000,
        ];

        for amount in test_cases {
            let result = SwapResult {
                output_amount: amount,
            };
            assert_eq!(result.output_amount, amount);
        }
    }

    #[test]
    fn test_swap_result_comparison() {
        let result1 = SwapResult { output_amount: 100 };
        let result2 = SwapResult { output_amount: 200 };

        assert!(result1.output_amount < result2.output_amount);
        assert!(result2.output_amount > result1.output_amount);
    }

    #[test]
    fn test_swap_result_arithmetic() {
        let result1 = SwapResult { output_amount: 100 };
        let result2 = SwapResult { output_amount: 200 };

        let total = result1.output_amount + result2.output_amount;
        assert_eq!(total, 300);
    }

    #[test]
    fn test_swap_result_with_slippage() {
        let original_amount = 1_000_000u64;
        let slippage_bps = 50u64; // 0.5%

        let result = SwapResult { output_amount: original_amount };
        
        // Calculate amount after slippage
        let after_slippage = result.output_amount * (10_000 - slippage_bps) / 10_000;
        assert_eq!(after_slippage, 995_000);
    }

    #[test]
    fn test_swap_result_fee_calculation() {
        let original_amount = 1_000_000u64;
        let fee_bps = 30u64; // 0.3%

        let result = SwapResult { output_amount: original_amount };
        
        // Calculate fee amount
        let fee = result.output_amount * fee_bps / 10_000;
        let after_fee = result.output_amount - fee;
        
        assert_eq!(fee, 3_000);
        assert_eq!(after_fee, 997_000);
    }

    #[test]
    fn test_swap_result_percentage_calculation() {
        let input_amount = 1_000_000u64;
        let output_amount = 1_100_000u64; // 10% gain

        let result = SwapResult { output_amount };
        
        let percentage_gain = ((result.output_amount as u128 * 10_000) / input_amount as u128) as u64;
        assert_eq!(percentage_gain, 11_000); // 110% represented in basis points
    }

    #[test]
    fn test_swap_result_multiple_swaps() {
        let swap1 = SwapResult { output_amount: 1_000_000 };
        let swap2 = SwapResult { output_amount: swap1.output_amount * 11 / 10 }; // 10% gain
        let swap3 = SwapResult { output_amount: swap2.output_amount * 105 / 100 }; // 5% gain

        assert_eq!(swap1.output_amount, 1_000_000);
        assert_eq!(swap2.output_amount, 1_100_000);
        assert_eq!(swap3.output_amount, 1_155_000);
    }

    #[test]
    fn test_swap_result_precision() {
        // Test with very small amounts (for tokens with high decimals)
        let small_amount = 1u64;
        let result = SwapResult { output_amount: small_amount };
        assert_eq!(result.output_amount, 1);

        // Test with very large amounts
        let large_amount = u64::MAX - 1;
        let result = SwapResult { output_amount: large_amount };
        assert_eq!(result.output_amount, u64::MAX - 1);
    }
}
