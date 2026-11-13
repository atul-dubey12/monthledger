package com.monthledger.goal;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "goals")
public class Goal {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 40) private String name;
    @Column(nullable = false, length = 8) private String icon;
    @Column(name = "target_amount", nullable = false, precision = 12, scale = 2) private BigDecimal targetAmount;
    @Column(name = "starting_amount", nullable = false, precision = 12, scale = 2) private BigDecimal startingAmount = BigDecimal.ZERO;
    @Column(name = "target_date") private LocalDate targetDate;
    @Column(nullable = false) private boolean archived;

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getIcon() { return icon; }
    public void setIcon(String icon) { this.icon = icon; }
    public BigDecimal getTargetAmount() { return targetAmount; }
    public void setTargetAmount(BigDecimal targetAmount) { this.targetAmount = targetAmount; }
    public BigDecimal getStartingAmount() { return startingAmount; }
    public void setStartingAmount(BigDecimal startingAmount) { this.startingAmount = startingAmount; }
    public LocalDate getTargetDate() { return targetDate; }
    public void setTargetDate(LocalDate targetDate) { this.targetDate = targetDate; }
    public boolean isArchived() { return archived; }
    public void setArchived(boolean archived) { this.archived = archived; }
}
