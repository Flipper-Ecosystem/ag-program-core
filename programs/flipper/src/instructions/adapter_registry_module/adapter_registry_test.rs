#[cfg(test)]
mod tests {
    use crate::state::*;
    use anchor_lang::prelude::*;

    #[test]
    fn test_adapter_info_creation() {
        let adapter = AdapterInfo {
            name: "Raydium".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };

        assert_eq!(adapter.name, "Raydium");
        assert_ne!(adapter.program_id, Pubkey::default());
    }

    #[test]
    fn test_adapter_info_different_swap_types() {
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

        let whirlpool = AdapterInfo {
            name: "Whirlpool".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Whirlpool { a_to_b: true },
        };

        assert_ne!(raydium.program_id, meteora.program_id);
        assert_ne!(meteora.program_id, whirlpool.program_id);
    }

    #[test]
    fn test_adapter_registry_initialization() {
        let authority = Pubkey::new_unique();
        let operator = Pubkey::new_unique();
        let adapter = AdapterInfo {
            name: "Test".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };

        let registry = AdapterRegistry {
            authority,
            operators: vec![operator],
            supported_adapters: vec![adapter],
            bump: 255,
        };

        assert_eq!(registry.authority, authority);
        assert_eq!(registry.operators.len(), 1);
        assert_eq!(registry.supported_adapters.len(), 1);
    }

    #[test]
    fn test_adapter_registry_multiple_operators() {
        let authority = Pubkey::new_unique();
        let operators: Vec<Pubkey> = (0..5).map(|_| Pubkey::new_unique()).collect();

        let registry = AdapterRegistry {
            authority,
            operators: operators.clone(),
            supported_adapters: vec![],
            bump: 255,
        };

        assert_eq!(registry.operators.len(), 5);
        for (i, op) in operators.iter().enumerate() {
            assert_eq!(registry.operators[i], *op);
        }
    }

    #[test]
    fn test_adapter_registry_multiple_adapters() {
        let adapters = vec![
            AdapterInfo {
                name: "Raydium".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Raydium,
            },
            AdapterInfo {
                name: "Meteora".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Meteora,
            },
            AdapterInfo {
                name: "Whirlpool".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Whirlpool { a_to_b: true },
            },
        ];

        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: adapters.clone(),
            bump: 255,
        };

        assert_eq!(registry.supported_adapters.len(), 3);
        assert_eq!(registry.supported_adapters[0].name, "Raydium");
        assert_eq!(registry.supported_adapters[1].name, "Meteora");
        assert_eq!(registry.supported_adapters[2].name, "Whirlpool");
    }

    #[test]
    fn test_adapter_registry_empty() {
        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: vec![],
            bump: 255,
        };

        assert_eq!(registry.operators.len(), 0);
        assert_eq!(registry.supported_adapters.len(), 0);
        assert_ne!(registry.authority, Pubkey::default());
    }

    #[test]
    fn test_adapter_registry_find_adapter() {
        let raydium_id = Pubkey::new_unique();
        let adapters = vec![
            AdapterInfo {
                name: "Raydium".to_string(),
                program_id: raydium_id,
                swap_type: Swap::Raydium,
            },
            AdapterInfo {
                name: "Meteora".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Meteora,
            },
        ];

        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: adapters,
            bump: 255,
        };

        let result = registry.get_adapter_program_id(&Swap::Raydium);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), raydium_id);
    }

    #[test]
    fn test_adapter_registry_authority_is_operator() {
        let authority = Pubkey::new_unique();
        let registry = AdapterRegistry {
            authority,
            operators: vec![],
            supported_adapters: vec![],
            bump: 255,
        };

        // Authority should be authorized even if not in operators list
        assert!(registry.is_authorized_operator(&authority));
    }

    #[test]
    fn test_adapter_info_clone() {
        let original = AdapterInfo {
            name: "Raydium".to_string(),
            program_id: Pubkey::new_unique(),
            swap_type: Swap::Raydium,
        };

        let cloned = original.clone();
        assert_eq!(cloned.name, original.name);
        assert_eq!(cloned.program_id, original.program_id);
    }

    #[test]
    fn test_adapter_registry_operator_list_modification() {
        let mut registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: vec![],
            bump: 255,
        };

        let new_operator = Pubkey::new_unique();
        registry.operators.push(new_operator);

        assert_eq!(registry.operators.len(), 1);
        assert!(registry.is_authorized_operator(&new_operator));
    }

    #[test]
    fn test_adapter_registry_remove_operator() {
        let operator1 = Pubkey::new_unique();
        let operator2 = Pubkey::new_unique();
        let operator3 = Pubkey::new_unique();

        let mut registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![operator1, operator2, operator3],
            supported_adapters: vec![],
            bump: 255,
        };

        assert_eq!(registry.operators.len(), 3);

        // Remove operator2
        registry.operators.retain(|op| *op != operator2);

        assert_eq!(registry.operators.len(), 2);
        assert!(registry.is_authorized_operator(&operator1));
        assert!(!registry.is_authorized_operator(&operator2));
        assert!(registry.is_authorized_operator(&operator3));
    }

    #[test]
    fn test_adapter_info_with_complex_swap_types() {
        let adapters = vec![
            AdapterInfo {
                name: "Serum Bid".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Serum { side: Side::Bid },
            },
            AdapterInfo {
                name: "Serum Ask".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Serum { side: Side::Ask },
            },
            AdapterInfo {
                name: "Symmetry".to_string(),
                program_id: Pubkey::new_unique(),
                swap_type: Swap::Symmetry { from_token_id: 1, to_token_id: 2 },
            },
        ];

        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: vec![],
            supported_adapters: adapters,
            bump: 255,
        };

        assert_eq!(registry.supported_adapters.len(), 3);
    }

    #[test]
    fn test_adapter_registry_large_operator_list() {
        let operators: Vec<Pubkey> = (0..100).map(|_| Pubkey::new_unique()).collect();
        
        let registry = AdapterRegistry {
            authority: Pubkey::new_unique(),
            operators: operators.clone(),
            supported_adapters: vec![],
            bump: 255,
        };

        assert_eq!(registry.operators.len(), 100);
        
        // Verify all operators are authorized
        for op in &operators {
            assert!(registry.is_authorized_operator(op));
        }
    }
}
