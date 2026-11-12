package com.monthledger;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:entries;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH")
@AutoConfigureMockMvc
@DirtiesContext
class EntryApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    // Seeded ids: 1 Salary (INCOME), 5 Groceries (NEED), 11 Food delivery (WANT), 17 Emergency fund (SAVING)
    private ResultActions post(String body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/entries").contentType(MediaType.APPLICATION_JSON).content(body));
    }
    private String entry(String date, String kind, String amount, int category) {
        return "{\"date\":\"" + date + "\",\"kind\":\"" + kind + "\",\"amount\":" + amount + ",\"categoryId\":" + category + ",\"paymentMode\":\"UPI\",\"note\":\"  \"}";
    }

    @Test
    void savesListsByRangeNewestFirstAndDeletes() throws Exception {
        post(entry("2026-11-05", "INCOME", "30000", 1)).andExpect(status().isCreated()).andExpect(jsonPath("$.note").value(nullValue()));
        post(entry("2026-11-06", "EXPENSE", "850.50", 5)).andExpect(status().isCreated());
        String saved = post(entry("2026-11-06", "SAVING", "6000", 17)).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        post(entry("2026-12-05", "EXPENSE", "100", 11)).andExpect(status().isCreated());

        mvc.perform(get("/api/entries").param("from", "2026-11-05").param("to", "2026-12-04"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(3)))
            .andExpect(jsonPath("$[0].kind").value("SAVING"))
            .andExpect(jsonPath("$[2].kind").value("INCOME"));

        JsonNode node = json.readTree(saved);
        mvc.perform(delete("/api/entries/" + node.get("id").asLong())).andExpect(status().isNoContent());
        mvc.perform(delete("/api/entries/" + node.get("id").asLong())).andExpect(status().isNotFound());
    }

    @Test
    void rejectsCategoryFromTheWrongBucketAndBadAmounts() throws Exception {
        post(entry("2026-11-07", "EXPENSE", "500", 1)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Salary can't be used for this kind of entry."));
        post(entry("2026-11-07", "INCOME", "500", 5)).andExpect(status().isBadRequest());
        post(entry("2026-11-07", "SAVING_WITHDRAWAL", "500", 11)).andExpect(status().isBadRequest());
        post(entry("2026-11-07", "EXPENSE", "0", 5)).andExpect(status().isBadRequest());
        post(entry("2026-11-07", "EXPENSE", "10.555", 5)).andExpect(status().isBadRequest());
        post(entry("2026-11-07", "EXPENSE", "10", 999)).andExpect(status().isBadRequest());
    }

    @Test
    void updatesAnEntry() throws Exception {
        String saved = post(entry("2026-11-08", "EXPENSE", "200", 11)).andReturn().getResponse().getContentAsString();
        long id = json.readTree(saved).get("id").asLong();
        mvc.perform(put("/api/entries/" + id).contentType(MediaType.APPLICATION_JSON).content(entry("2026-11-09", "EXPENSE", "250", 5)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.amount").value(250)).andExpect(jsonPath("$.categoryId").value(5));
        mvc.perform(put("/api/entries/99999").contentType(MediaType.APPLICATION_JSON).content(entry("2026-11-09", "EXPENSE", "250", 5)))
            .andExpect(status().isNotFound());
    }

    @Test
    void usedCategoryCannotChangeBucket() throws Exception {
        post(entry("2026-11-09", "EXPENSE", "120", 13)).andExpect(status().isCreated());   // 13 = Entertainment & OTT (WANT)
        String move = "{\"name\":\"Entertainment & OTT\",\"icon\":\"🎬\",\"bucket\":\"NEED\",\"monthlyBudget\":500}";
        mvc.perform(put("/api/categories/13").contentType(MediaType.APPLICATION_JSON).content(move)).andExpect(status().isBadRequest());
        String budget = "{\"name\":\"OTT & movies\",\"icon\":\"🎬\",\"bucket\":\"WANT\",\"monthlyBudget\":500}";
        mvc.perform(put("/api/categories/13").contentType(MediaType.APPLICATION_JSON).content(budget))
            .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("OTT & movies")).andExpect(jsonPath("$.monthlyBudget").value(500));
    }

    @Test
    void listNeedsAValidRange() throws Exception {
        mvc.perform(get("/api/entries").param("from", "2026-11-10").param("to", "2026-11-01")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/entries").param("from", "2024-01-01").param("to", "2026-11-01")).andExpect(status().isBadRequest());
    }
}
