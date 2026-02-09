#[cfg(test)]
mod tests {
    use super::super::*;
    use anchor_lang::prelude::*;

    fn create_test_limit_order(
        trigger_type: TriggerType,
        trigger_price_bps: u32,
        min_output_amount: u64,
    ) -> LimitOrder {
        LimitOrder {
            creator: Pubkey::new_unique(),
            input_mint: Pubkey::new_unique(),
            output_mint: Pubkey::new_unique(),
            input_vault: Pubkey::new_unique(),
            user_destination_account: Pubkey::new_unique(),
            input_amount: 1000000,
            min_output_amount,
            trigger_price_bps,
            trigger_type,
            expiry: 0,
            status: OrderStatus::Open,
            slippage_bps: 50,
            bump: 0,
        }
    }

    #[test]
    fn test_limit_order_should_execute_take_profit_exact_trigger() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000, // 10% increase
            100_000,
        );

        // Exactly at trigger price: 100,000 * 1.10 = 110,000
        let result = order.should_execute(110_000);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_take_profit_above_trigger() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000, // 10% increase
            100_000,
        );

        // Above trigger price: 100,000 * 1.15 = 115,000
        let result = order.should_execute(115_000);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_take_profit_below_trigger() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000, // 10% increase
            100_000,
        );

        // Below trigger price: 100,000 * 1.05 = 105,000
        let result = order.should_execute(105_000);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_stop_loss_exact_trigger() {
        let order = create_test_limit_order(
            TriggerType::StopLoss,
            1000, // 10% decrease
            100_000,
        );

        // Exactly at trigger price: 100,000 * 0.90 = 90,000
        let result = order.should_execute(90_000);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_stop_loss_below_trigger() {
        let order = create_test_limit_order(
            TriggerType::StopLoss,
            1000, // 10% decrease
            100_000,
        );

        // Below trigger price: 100,000 * 0.85 = 85,000
        let result = order.should_execute(85_000);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_stop_loss_above_trigger() {
        let order = create_test_limit_order(
            TriggerType::StopLoss,
            1000, // 10% decrease
            100_000,
        );

        // Above trigger price: 100,000 * 0.95 = 95,000
        let result = order.should_execute(95_000);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_high_percentage_take_profit() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            50_000, // 500% increase
            100_000,
        );

        // At trigger price: 100,000 * 6.0 = 600,000
        let result = order.should_execute(600_000);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Below trigger
        let result = order.should_execute(500_000);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_small_amounts() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            500, // 5% increase
            100, // Small amount
        );

        // At trigger: 100 * 1.05 = 105
        let result = order.should_execute(105);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Below trigger
        let result = order.should_execute(104);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_calculate_min_acceptable_output() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000,
            100_000,
        );

        // With 50 bps slippage (0.5%)
        let result = order.calculate_min_acceptable_output(100_000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 99_500); // 100,000 * 0.995

        // With different quoted amount
        let result = order.calculate_min_acceptable_output(200_000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 199_000); // 200,000 * 0.995
    }

    #[test]
    fn test_limit_order_calculate_min_acceptable_output_zero_slippage() {
        let mut order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000,
            100_000,
        );
        order.slippage_bps = 0;

        let result = order.calculate_min_acceptable_output(100_000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 100_000);
    }

    #[test]
    fn test_limit_order_calculate_min_acceptable_output_max_slippage() {
        let mut order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000,
            100_000,
        );
        order.slippage_bps = 1000; // 10%

        let result = order.calculate_min_acceptable_output(100_000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 90_000); // 100,000 * 0.90
    }

    #[test]
    fn test_trigger_type_discriminant() {
        assert_eq!(TriggerType::TakeProfit as u8, 0);
        assert_eq!(TriggerType::StopLoss as u8, 1);
    }

    #[test]
    fn test_order_status_discriminant() {
        assert_eq!(OrderStatus::Open as u8, 0);
        assert_eq!(OrderStatus::Filled as u8, 1);
        assert_eq!(OrderStatus::Cancelled as u8, 2);
        assert_eq!(OrderStatus::Init as u8, 3);
    }

    #[test]
    fn test_trigger_type_equality() {
        assert_eq!(TriggerType::TakeProfit, TriggerType::TakeProfit);
        assert_eq!(TriggerType::StopLoss, TriggerType::StopLoss);
        assert_ne!(TriggerType::TakeProfit, TriggerType::StopLoss);
    }

    #[test]
    fn test_order_status_equality() {
        assert_eq!(OrderStatus::Open, OrderStatus::Open);
        assert_eq!(OrderStatus::Filled, OrderStatus::Filled);
        assert_eq!(OrderStatus::Cancelled, OrderStatus::Cancelled);
        assert_eq!(OrderStatus::Init, OrderStatus::Init);
        assert_ne!(OrderStatus::Open, OrderStatus::Filled);
    }

    #[test]
    fn test_limit_order_space_constant() {
        // Verify the SPACE constant matches the actual struct size
        // This is important for account initialization
        assert_eq!(LimitOrder::SPACE, 8 + 193);
    }

    #[test]
    fn test_limit_order_should_execute_edge_case_zero_output() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000,
            100_000,
        );

        // Zero output should not trigger
        let result = order.should_execute(0);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_precision() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            100, // 1% increase
            1_000_000_000, // 1 billion
        );

        // Just at trigger: 1,000,000,000 * 1.01 = 1,010,000,000
        let result = order.should_execute(1_010_000_000);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Just below trigger
        let result = order.should_execute(1_009_999_999);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_calculate_output_with_small_amounts() {
        let mut order = create_test_limit_order(
            TriggerType::TakeProfit,
            1000,
            1,
        );
        order.slippage_bps = 100; // 1%

        let result = order.calculate_min_acceptable_output(100);
        assert!(result.is_ok());
        // 100 * 0.99 = 99
        assert_eq!(result.unwrap(), 99);
    }

    #[test]
    fn test_limit_order_should_execute_max_trigger_take_profit() {
        let order = create_test_limit_order(
            TriggerType::TakeProfit,
            100_000, // 1000% increase (maximum allowed)
            100_000,
        );

        // At trigger: 100,000 * 11.0 = 1,100,000
        let result = order.should_execute(1_100_000);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Below trigger
        let result = order.should_execute(1_099_999);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_limit_order_should_execute_max_trigger_stop_loss() {
        let order = create_test_limit_order(
            TriggerType::StopLoss,
            9_000, // 90% decrease
            100_000,
        );

        // At trigger: 100,000 * 0.10 = 10,000
        let result = order.should_execute(10_000);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Below trigger: 100,000 * 0.05 = 5,000
        let result = order.should_execute(5_000);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Above trigger: 100,000 * 0.15 = 15,000
        let result = order.should_execute(15_000);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
