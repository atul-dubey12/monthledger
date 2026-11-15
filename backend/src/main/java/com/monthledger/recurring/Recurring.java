package com.monthledger.recurring;

import com.monthledger.entry.EntryKind;
import com.monthledger.entry.PaymentMode;
import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "recurring")
public class Recurring {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 40) private String name;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private EntryKind kind;
    @Column(nullable = false, precision = 12, scale = 2) private BigDecimal amount;
    @Column(name = "category_id", nullable = false) private Long categoryId;
    @Column(name = "goal_id") private Long goalId;
    @Column(name = "day_of_month", nullable = false) private int dayOfMonth;
    @Enumerated(EnumType.STRING) @Column(name = "payment_mode", length = 10) private PaymentMode paymentMode;
    @Column(nullable = false) private boolean active = true;

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public EntryKind getKind() { return kind; }
    public void setKind(EntryKind kind) { this.kind = kind; }
    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public Long getGoalId() { return goalId; }
    public void setGoalId(Long goalId) { this.goalId = goalId; }
    public int getDayOfMonth() { return dayOfMonth; }
    public void setDayOfMonth(int dayOfMonth) { this.dayOfMonth = dayOfMonth; }
    public PaymentMode getPaymentMode() { return paymentMode; }
    public void setPaymentMode(PaymentMode paymentMode) { this.paymentMode = paymentMode; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
}
