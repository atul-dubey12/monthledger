package com.monthledger.category;

import java.math.BigDecimal;

public record CategoryRequest(String name, String icon, Bucket bucket, BigDecimal monthlyBudget, Boolean archived) {}
