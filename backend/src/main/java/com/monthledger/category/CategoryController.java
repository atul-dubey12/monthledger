package com.monthledger.category;

import com.monthledger.entry.EntryRepository;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Categories are archived rather than deleted, so past entries keep their category. */
@RestController
@RequestMapping("/api/categories")
public class CategoryController {
    private static final BigDecimal MAX_BUDGET = new BigDecimal("10000000");
    private final CategoryRepository repository;
    private final EntryRepository entries;

    public CategoryController(CategoryRepository repository, EntryRepository entries) {
        this.repository = repository;
        this.entries = entries;
    }

    @GetMapping
    public List<Category> list() { return repository.findAllByOrderBySortOrderAscIdAsc(); }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Category create(@RequestBody CategoryRequest request) {
        validate(request);
        if (repository.existsByNameIgnoreCaseAndArchivedFalse(request.name().trim())) throw bad("A category with this name already exists.");
        Category category = new Category();
        apply(category, request);
        category.setSortOrder(repository.findAll().stream().mapToInt(Category::getSortOrder).max().orElse(0) + 10);
        return repository.save(category);
    }

    @PutMapping("/{id}")
    public Category update(@PathVariable Long id, @RequestBody CategoryRequest request) {
        validate(request);
        Category category = repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found."));
        if (!category.getName().equalsIgnoreCase(request.name().trim()) && repository.existsByNameIgnoreCaseAndArchivedFalse(request.name().trim())) {
            throw bad("A category with this name already exists.");
        }
        // Entries are checked against their category's bucket, so a used category keeps its bucket.
        if (category.getBucket() != request.bucket() && entries.existsByCategoryId(id)) {
            throw bad("This category already has entries, so it can't move to another bucket. Add a new category instead.");
        }
        apply(category, request);
        if (request.archived() != null) category.setArchived(request.archived());
        return repository.save(category);
    }

    private void apply(Category category, CategoryRequest request) {
        category.setName(request.name().trim());
        category.setIcon(request.icon() == null || request.icon().isBlank() ? "•" : request.icon().trim());
        category.setBucket(request.bucket());
        category.setMonthlyBudget(request.monthlyBudget());
    }

    private void validate(CategoryRequest request) {
        if (request.name() == null || request.name().isBlank()) throw bad("Give the category a name.");
        if (request.name().trim().length() > 40) throw bad("Category names can be up to 40 characters.");
        if (request.icon() != null && request.icon().trim().length() > 8) throw bad("Pick a single emoji for the icon.");
        if (request.bucket() == null) throw bad("Choose Needs, Wants, Savings or Income.");
        BigDecimal budget = request.monthlyBudget();
        if (budget != null && (budget.signum() < 0 || budget.compareTo(MAX_BUDGET) > 0)) throw bad("Budget must be between ₹0 and ₹1,00,00,000.");
        if (budget != null && budget.scale() > 2) throw bad("Budget can have at most 2 decimal places.");
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
