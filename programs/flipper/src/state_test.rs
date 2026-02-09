#[cfg(test)]
mod tests {
    use super::super::state::*;
    use anchor_lang::prelude::*;

    #[test]
    fn test_adapter_registry_is_supported_adapter() {
        let adapter = AdapterInfo {
            name: "Raydium".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };
        
        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: vec![adapter],
            bump: 255,
        };

        assert!(registry.is_supported_adapter(&Swap::Raydium));
        assert!(!registry.is_supported_adapter(&Swap::Meteora));
    }

    #[test]
    fn test_adapter_registry_get_adapter_program_id() {
        let program_id = Pubkey::new_unique();
        let adapter = AdapterInfo {
            name: "Raydium".to_string(),
            program_id,
            swap_type: Swap::Raydium,
        };
        
        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: vec![adapter],
            bump: 255,
        };

        let result = registry.get_adapter_program_id(&Swap::Raydium);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), program_id);

        let result = registry.get_adapter_program_id(&Swap::Meteora);
        assert!(result.is_err());
    }

    #[test]
    fn test_adapter_registry_is_authorized_operator() {
        let authority = Pubkey::new_unique();
        let operator1 = Pubkey::new_unique();
        let operator2 = Pubkey::new_unique();
        let non_operator = Pubkey::new_unique();

        let registry = AdapterRegistry {
            authority,
            operators: vec![operator1, operator2],
            supported_adapters: vec![],
            bump: 255,
        };

        assert!(registry.is_authorized_operator(&authority));
        assert!(registry.is_authorized_operator(&operator1));
        assert!(registry.is_authorized_operator(&operator2));
        assert!(!registry.is_authorized_operator(&non_operator));
    }

    #[test]
    fn test_adapter_registry_multiple_adapters() {
        let raydium = AdapterInfo {
            name: "Raydium".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };
        let meteora = AdapterInfo {
            name: "Meteora".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Meteora,
        };
        
        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: vec![raydium, meteora],
            bump: 255,
        };

        assert!(registry.is_supported_adapter(&Swap::Raydium));
        assert!(registry.is_supported_adapter(&Swap::Meteora));
        assert!(!registry.is_supported_adapter(&Swap::Lifinity));
    }

    #[test]
    fn test_swap_to_bytes_simple_variants() {
        let test_cases = vec![
            (Swap::Saber, 0),
            (Swap::SaberAddDecimalsDeposit, 1),
            (Swap::SaberAddDecimalsWithdraw, 2),
            (Swap::TokenSwap, 3),
            (Swap::Sencha, 4),
            (Swap::Step, 5),
            (Swap::Cropper, 6),
            (Swap::Raydium, 7),
            (Swap::Lifinity, 9),
            (Swap::Mercurial, 10),
            (Swap::Cykura, 11),
            (Swap::MarinadeDeposit, 13),
            (Swap::MarinadeUnstake, 14),
            (Swap::Meteora, 19),
            (Swap::GooseFX, 20),
            (Swap::Balansol, 22),
            (Swap::LifinityV2, 25),
            (Swap::RaydiumClmm, 26),
        ];

        for (swap, expected_byte) in test_cases {
            let bytes = swap.to_bytes();
            assert_eq!(bytes[0], expected_byte, "Failed for swap variant with expected byte {}", expected_byte);
            // Rest should be zeros
            assert!(bytes[1..].iter().all(|&b| b == 0), "Non-zero bytes found after first byte");
        }
    }

    #[test]
    fn test_swap_to_bytes_with_bool_variants() {
        let test_cases = vec![
            (Swap::Crema { a_to_b: true }, 8, 1),
            (Swap::Crema { a_to_b: false }, 8, 0),
            (Swap::Whirlpool { a_to_b: true }, 17, 1),
            (Swap::Whirlpool { a_to_b: false }, 17, 0),
            (Swap::Invariant { x_to_y: true }, 18, 1),
            (Swap::Invariant { x_to_y: false }, 18, 0),
            (Swap::DeltaFi { stable: true }, 21, 1),
            (Swap::DeltaFi { stable: false }, 21, 0),
            (Swap::MarcoPolo { x_to_y: true }, 23, 1),
            (Swap::MarcoPolo { x_to_y: false }, 23, 0),
        ];

        for (swap, expected_first, expected_second) in test_cases {
            let bytes = swap.to_bytes();
            assert_eq!(bytes[0], expected_first);
            assert_eq!(bytes[1], expected_second);
        }
    }

    #[test]
    fn test_swap_to_bytes_with_side_variants() {
        let test_cases = vec![
            (Swap::Serum { side: Side::Bid }, 12, 0),
            (Swap::Serum { side: Side::Ask }, 12, 1),
            (Swap::Aldrin { side: Side::Bid }, 15, 0),
            (Swap::Aldrin { side: Side::Ask }, 15, 1),
            (Swap::AldrinV2 { side: Side::Bid }, 16, 0),
            (Swap::AldrinV2 { side: Side::Ask }, 16, 1),
            (Swap::Dradex { side: Side::Bid }, 24, 0),
            (Swap::Dradex { side: Side::Ask }, 24, 1),
            (Swap::Openbook { side: Side::Bid }, 27, 0),
            (Swap::Openbook { side: Side::Ask }, 27, 1),
            (Swap::Phoenix { side: Side::Bid }, 28, 0),
            (Swap::Phoenix { side: Side::Ask }, 28, 1),
        ];

        for (swap, expected_first, expected_second) in test_cases {
            let bytes = swap.to_bytes();
            assert_eq!(bytes[0], expected_first);
            assert_eq!(bytes[1], expected_second);
        }
    }

    #[test]
    fn test_swap_to_bytes_symmetry() {
        let swap = Swap::Symmetry { 
            from_token_id: 123456789, 
            to_token_id: 987654321 
        };
        let bytes = swap.to_bytes();
        assert_eq!(bytes[0], 29);
        
        // Verify token IDs are encoded correctly in little-endian format
        let from_bytes = &bytes[1..9];
        let to_bytes = &bytes[9..17];
        assert_eq!(u64::from_le_bytes(from_bytes.try_into().unwrap()), 123456789);
        assert_eq!(u64::from_le_bytes(to_bytes.try_into().unwrap()), 987654321);
    }

    #[test]
    fn test_swap_to_bytes_symmetry_edge_cases() {
        // Test with 0 values
        let swap_zeros = Swap::Symmetry { from_token_id: 0, to_token_id: 0 };
        let bytes_zeros = swap_zeros.to_bytes();
        assert_eq!(bytes_zeros[0], 29);
        assert_eq!(u64::from_le_bytes(bytes_zeros[1..9].try_into().unwrap()), 0);
        assert_eq!(u64::from_le_bytes(bytes_zeros[9..17].try_into().unwrap()), 0);

        // Test with max values
        let swap_max = Swap::Symmetry { from_token_id: u64::MAX, to_token_id: u64::MAX };
        let bytes_max = swap_max.to_bytes();
        assert_eq!(bytes_max[0], 29);
        assert_eq!(u64::from_le_bytes(bytes_max[1..9].try_into().unwrap()), u64::MAX);
        assert_eq!(u64::from_le_bytes(bytes_max[9..17].try_into().unwrap()), u64::MAX);
    }

    #[test]
    fn test_swap_equality() {
        assert_eq!(Swap::Raydium, Swap::Raydium);
        assert_ne!(Swap::Raydium, Swap::Meteora);
        
        assert_eq!(
            Swap::Whirlpool { a_to_b: true }, 
            Swap::Whirlpool { a_to_b: true }
        );
        assert_ne!(
            Swap::Whirlpool { a_to_b: true }, 
            Swap::Whirlpool { a_to_b: false }
        );

        assert_eq!(
            Swap::Serum { side: Side::Bid },
            Swap::Serum { side: Side::Bid }
        );
        assert_ne!(
            Swap::Serum { side: Side::Bid },
            Swap::Serum { side: Side::Ask }
        );

        assert_eq!(
            Swap::Symmetry { from_token_id: 1, to_token_id: 2 },
            Swap::Symmetry { from_token_id: 1, to_token_id: 2 }
        );
        assert_ne!(
            Swap::Symmetry { from_token_id: 1, to_token_id: 2 },
            Swap::Symmetry { from_token_id: 2, to_token_id: 1 }
        );
    }

    #[test]
    fn test_side_equality() {
        assert_eq!(Side::Bid, Side::Bid);
        assert_eq!(Side::Ask, Side::Ask);
        assert_ne!(Side::Bid, Side::Ask);
    }

    #[test]
    fn test_swap_clone() {
        let original = Swap::Whirlpool { a_to_b: true };
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn test_adapter_info_clone() {
        let original = AdapterInfo {
            name: "Test".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };
        let cloned = original.clone();
        assert_eq!(cloned.name, original.name);
        assert_eq!(cloned.program_id, original.program_id);
    }
}
