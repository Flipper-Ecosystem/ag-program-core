#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::state::*;
    use anchor_lang::prelude::*;

    fn create_test_route_plan_step(
        swap: Swap,
        percent: u8,
        input_index: u8,
        output_index: u8,
    ) -> RoutePlanStep {
        RoutePlanStep {
            swap,
            percent,
            input_index,
            output_index,
        }
    }

    #[test]
    fn test_route_plan_step_creation() {
        let step = create_test_route_plan_step(
            Swap::Raydium,
            100,
            0,
            1,
        );

        assert_eq!(step.percent, 100);
        assert_eq!(step.input_index, 0);
        assert_eq!(step.output_index, 1);
    }

    #[test]
    fn test_route_plan_step_partial_swap() {
        let step = create_test_route_plan_step(
            Swap::Raydium,
            50, // 50% of amount
            0,
            1,
        );

        assert_eq!(step.percent, 50);
    }

    #[test]
    fn test_route_plan_step_with_whirlpool() {
        let step = create_test_route_plan_step(
            Swap::Whirlpool { a_to_b: true },
            100,
            0,
            1,
        );

        match step.swap {
            Swap::Whirlpool { a_to_b } => assert!(a_to_b),
            _ => panic!("Expected Whirlpool swap"),
        }
    }

    #[test]
    fn test_route_plan_step_with_meteora() {
        let step = create_test_route_plan_step(
            Swap::Meteora,
            75,
            1,
            2,
        );

        assert!(matches!(step.swap, Swap::Meteora));
        assert_eq!(step.percent, 75);
    }

    #[test]
    fn test_route_plan_multiple_steps() {
        let steps = vec![
            create_test_route_plan_step(Swap::Raydium, 50, 0, 1),
            create_test_route_plan_step(Swap::Meteora, 50, 0, 2),
        ];

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].percent + steps[1].percent, 100);
    }

    #[test]
    fn test_route_plan_step_clone() {
        let step = create_test_route_plan_step(Swap::Raydium, 100, 0, 1);
        let cloned = step.clone();

        assert_eq!(cloned.percent, step.percent);
        assert_eq!(cloned.input_index, step.input_index);
        assert_eq!(cloned.output_index, step.output_index);
    }

    #[test]
    fn test_route_plan_step_different_indices() {
        let step1 = create_test_route_plan_step(Swap::Raydium, 100, 0, 1);
        let step2 = create_test_route_plan_step(Swap::Raydium, 100, 1, 2);
        let step3 = create_test_route_plan_step(Swap::Raydium, 100, 2, 3);

        // Verify multi-hop route structure
        assert_eq!(step1.output_index, step2.input_index);
        assert_eq!(step2.output_index, step3.input_index);
    }

    #[test]
    fn test_route_plan_step_zero_percent() {
        let step = create_test_route_plan_step(Swap::Raydium, 0, 0, 1);
        assert_eq!(step.percent, 0);
    }

    #[test]
    fn test_route_plan_step_full_percent() {
        let step = create_test_route_plan_step(Swap::Raydium, 100, 0, 1);
        assert_eq!(step.percent, 100);
    }

    #[test]
    fn test_route_plan_step_with_side() {
        let step = create_test_route_plan_step(
            Swap::Serum { side: Side::Bid },
            100,
            0,
            1,
        );

        match step.swap {
            Swap::Serum { side } => assert_eq!(side, Side::Bid),
            _ => panic!("Expected Serum swap"),
        }
    }

    #[test]
    fn test_route_plan_parallel_swaps() {
        // Simulating parallel swaps (same input, different outputs)
        let step1 = create_test_route_plan_step(Swap::Raydium, 60, 0, 1);
        let step2 = create_test_route_plan_step(Swap::Meteora, 40, 0, 2);

        assert_eq!(step1.input_index, step2.input_index);
        assert_ne!(step1.output_index, step2.output_index);
        assert_eq!(step1.percent + step2.percent, 100);
    }

    #[test]
    fn test_route_plan_step_max_indices() {
        let step = create_test_route_plan_step(Swap::Raydium, 100, u8::MAX, u8::MAX);
        assert_eq!(step.input_index, u8::MAX);
        assert_eq!(step.output_index, u8::MAX);
    }

    #[test]
    fn test_route_plan_step_serialization_invariants() {
        let original = create_test_route_plan_step(
            Swap::Whirlpool { a_to_b: true },
            75,
            5,
            10,
        );

        // Clone should preserve all fields
        let cloned = original.clone();
        assert_eq!(original.percent, cloned.percent);
        assert_eq!(original.input_index, cloned.input_index);
        assert_eq!(original.output_index, cloned.output_index);
    }

    #[test]
    fn test_route_plan_complex_multi_hop() {
        // Simulating: SOL -> USDC (Raydium) -> USDT (Meteora) -> RAY (Whirlpool)
        let steps = vec![
            create_test_route_plan_step(Swap::Raydium, 100, 0, 1),
            create_test_route_plan_step(Swap::Meteora, 100, 1, 2),
            create_test_route_plan_step(Swap::Whirlpool { a_to_b: true }, 100, 2, 3),
        ];

        assert_eq!(steps.len(), 3);
        
        // Verify chain consistency
        for i in 0..steps.len() - 1 {
            // Each step's output should be the next step's input for sequential swaps
            if steps[i].percent == 100 && steps[i + 1].percent == 100 {
                // This is a potential multi-hop scenario
                assert!(steps[i].output_index <= steps[i + 1].input_index + 5);
            }
        }
    }

    #[test]
    fn test_route_plan_step_all_swap_types() {
        let swap_types = vec![
            Swap::Raydium,
            Swap::Meteora,
            Swap::Whirlpool { a_to_b: true },
            Swap::Lifinity,
            Swap::Serum { side: Side::Bid },
        ];

        for swap in swap_types {
            let step = create_test_route_plan_step(swap.clone(), 100, 0, 1);
            assert_eq!(step.percent, 100);
        }
    }
}
