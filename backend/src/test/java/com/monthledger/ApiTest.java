package com.monthledger;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH",
    "app.api-key=test-key-test-key-test-key-test-key"
})
@AutoConfigureMockMvc
@DirtiesContext
class ApiTest {
    private static final String KEY = "test-key-test-key-test-key-test-key";
    @Autowired MockMvc mvc;

    @Test
    void healthNeedsNoKeyButEverythingElseDoes() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk());
        mvc.perform(get("/api/categories")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/categories").header("X-Api-Key", "wrong")).andExpect(status().isUnauthorized());
    }

    @Test
    void seedsCategoriesAndDefaultSettings() throws Exception {
        mvc.perform(get("/api/categories").header("X-Api-Key", KEY))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(22)))
            .andExpect(jsonPath("$[0].name").value("Salary"))
            .andExpect(jsonPath("$[?(@.bucket == 'NEED')]", hasSize(8)))
            .andExpect(jsonPath("$[?(@.name == 'Home contribution')].monthlyBudget", contains(15000.0)))
            .andExpect(jsonPath("$[?(@.name == 'Supplements')].bucket", contains("WANT")))
            .andExpect(jsonPath("$[?(@.name == 'Shopping')].monthlyBudget", contains(2000.0)));
        mvc.perform(get("/api/settings").header("X-Api-Key", KEY))
            .andExpect(jsonPath("$.monthStartDay").value(5))
            .andExpect(jsonPath("$.needsPercent").value(50))
            .andExpect(jsonPath("$.wantsPercent").value(30))
            .andExpect(jsonPath("$.savingsPercent").value(20));
    }

    @Test
    void rejectsSplitThatDoesNotAddUpAndBadStartDay() throws Exception {
        put("{\"name\":\"Atul\",\"needsPercent\":50,\"wantsPercent\":30,\"savingsPercent\":30,\"monthStartDay\":5}")
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Needs, wants and savings must add up to 100%."));
        put("{\"name\":\"Atul\",\"needsPercent\":50,\"wantsPercent\":30,\"savingsPercent\":20,\"monthStartDay\":31}")
            .andExpect(status().isBadRequest());
        put("{\"name\":\"Atul\",\"needsPercent\":60,\"wantsPercent\":20,\"savingsPercent\":20,\"monthStartDay\":5}")
            .andExpect(status().isOk()).andExpect(jsonPath("$.needsPercent").value(60));
    }

    @Test
    void createsAndArchivesCategories() throws Exception {
        String body = "{\"name\":\"Gym\",\"icon\":\"🏋️\",\"bucket\":\"WANT\",\"monthlyBudget\":1500}";
        mvc.perform(post("/api/categories").header("X-Api-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.monthlyBudget").value(1500));
        mvc.perform(post("/api/categories").header("X-Api-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());
    }

    private org.springframework.test.web.servlet.ResultActions put(String json) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/settings")
            .header("X-Api-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(json));
    }
}
